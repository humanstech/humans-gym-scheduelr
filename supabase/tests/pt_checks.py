"""Personal trainer: billing engine, wallet reconciliation, roles and booking rules."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import subprocess
import unittest
import uuid

CONTAINER = os.environ['GYM_TEST_CONTAINER']
SPACE = '20000000-0000-4000-8000-000000000001'


def sql(statement, user=None, ok=True):
    if user:
        claims = json.dumps({'sub': user[0], 'email': user[1]}).replace("'", "''")
        statement = f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{claims}'; {statement}; COMMIT;"
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-Atq',
                             '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result


def value(statement, user=None):
    return sql(statement, user).stdout.strip()


class PersonalTrainerChecks(unittest.TestCase):
    def setUp(self):
        sql("""TRUNCATE public.bookings, public.slots, public.space_time_slots, public.spaces, auth.users, public.admins,
                 public.allowed_domains, public.allowed_emails, public.pt_trainers, public.pt_memberships,
                 public.pt_sessions, public.pt_session_exclusions, public.pt_session_payers, public.pt_wallet_entries CASCADE;
               UPDATE public.pt_settings SET session_price_cents = 4000, low_balance_threshold_cents = 1500,
                 max_participants = 4, full_session_min = 3;
               INSERT INTO public.allowed_domains(domain) VALUES ('humans.tech');
               INSERT INTO public.admins(email) VALUES ('admin@humans.tech');
               INSERT INTO public.pt_trainers(email) VALUES ('coach@trainers.example');""")
        # Sorted ids so remainder cents go to m[0], m[1], ... deterministically.
        ids = sorted(str(uuid.uuid4()) for _ in range(8))
        self.m = [(ids[i], f'member{i}@humans.tech') for i in range(8)]
        self.guest = (str(uuid.uuid4()), 'guest@humans.tech')
        self.admin = (str(uuid.uuid4()), 'admin@humans.tech')
        self.trainer = (str(uuid.uuid4()), 'coach@trainers.example')
        rows = ','.join(f"('{u}','{e}','{{\"full_name\":\"User {e[:7]}\"}}')"
                        for u, e in [*self.m, self.guest, self.admin, self.trainer])
        sql(f"INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES {rows};"
            f"INSERT INTO public.spaces(id,name,max_capacity,min_capacity) VALUES ('{SPACE}','Palestra',7,3);"
            + ''.join(f"INSERT INTO public.pt_memberships(user_id,valid_from) VALUES ('{u}', current_date-60);" for u, _ in self.m))

    # Helpers -------------------------------------------------------------
    def slot(self, day, start, people=(), pt=True, end=None):
        """Insert a slot (optionally a PT session) with direct bookings; day is a SQL date expression."""
        slot = str(uuid.uuid4())
        end = end or f'{int(start[:2]) + 1:02d}:{start[3:]}'
        statement = (f"INSERT INTO public.slots(id,space_id,date,start_time,end_time,max_capacity,min_capacity) "
                     f"VALUES ('{slot}','{SPACE}',{day},'{start}','{end}',{4 if pt else 7},{1 if pt else 3});")
        if pt:
            statement += f"INSERT INTO public.pt_sessions(slot_id,price_cents) VALUES ('{slot}',4000);"
        for user in people:
            statement += (f"INSERT INTO public.bookings(slot_id,user_id,user_email,user_name) "
                          f"VALUES ('{slot}','{user[0]}','{user[1]}','{user[1]}');")
        sql(statement)
        return slot

    def reconcile(self, day='current_date-3'):
        return int(value(f"SELECT private.pt_reconcile_day({day}, 'test')"))

    def costs(self, day='current_date-3'):
        """Net cost per user for a day from posted entries (positive = cost)."""
        out = value(f"SELECT user_id, -sum(amount_cents) FROM public.pt_wallet_entries WHERE session_date = {day} "
                    "GROUP BY user_id HAVING sum(amount_cents) <> 0")
        return {line.split('|')[0]: int(line.split('|')[1]) for line in out.splitlines()}

    def expected(self, day='current_date-3'):
        out = value(f"SELECT user_id, sum(amount_cents) FROM private.pt_compute_day({day}) WHERE user_id IS NOT NULL GROUP BY 1")
        return {line.split('|')[0]: int(line.split('|')[1]) for line in out.splitlines()}

    def admin_call(self, statement, user=None, ok=True):
        return sql(statement, user or self.admin, ok)

    def assert_error(self, result, message):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)

    def balance(self, user):
        return int(value(f"SELECT coalesce(sum(amount_cents),0) FROM public.pt_wallet_entries WHERE user_id='{user[0]}'"))

    # Spec examples ---------------------------------------------------------
    def test_case_a_full_session_pools_all_presences(self):
        self.slot('current_date-3', '10:00', self.m[:4])
        self.slot('current_date-3', '13:00', self.m[4:6])
        self.reconcile()
        costs = self.costs()
        self.assertEqual(sum(costs.values()), 8000)
        self.assertEqual(sorted(costs.values()), [1333, 1333, 1333, 1333, 1334, 1334])
        self.assertEqual(costs[self.m[0][0]], 1334)
        self.assertNotIn(self.m[6][0], costs)
        desc = value(f"SELECT description FROM public.pt_wallet_entries WHERE user_id='{self.m[0][0]}'")
        self.assertEqual(desc, value("SELECT 'Seduta ' || to_char(current_date-3,'DD/MM') || ' 10:00 · 80€ divisi su 6 presenze'"))
        self.assertEqual(value("SELECT DISTINCT kind || (details->>'mode') FROM public.pt_wallet_entries"), 'chargepooled')

    def test_case_b_shared_quota_when_other_session_empty(self):
        self.slot('current_date-3', '10:00', self.m[:2])
        self.slot('current_date-3', '13:00')
        self.reconcile()
        self.assertEqual(self.costs(), {u: 500 for u, _ in self.m})
        desc = value(f"SELECT description FROM public.pt_wallet_entries WHERE user_id='{self.m[7][0]}'")
        self.assertEqual(desc, value("SELECT 'Quota condivisa ' || to_char(current_date-3,'DD/MM') "
                                     "|| ' · seduta con 2 presenze, 40€ divisi tra 8 iscritti'"))

    def test_case_b_shared_quota_plus_pooled_other_sessions(self):
        self.slot('current_date-3', '10:00', self.m[:2])
        self.slot('current_date-3', '13:00', [self.m[2]])
        self.reconcile()
        costs = self.costs()
        self.assertEqual(sum(costs.values()), 8000)
        self.assertEqual([costs[u] for u, _ in self.m[:3]], [500 + 1334, 500 + 1333, 500 + 1333])
        self.assertTrue(all(costs[u] == 500 for u, _ in self.m[3:]))
        self.assertEqual(value(f"SELECT count(*) FROM public.pt_wallet_entries WHERE user_id='{self.m[0][0]}'"), '2')
        self.assertEqual(value(f"SELECT description FROM public.pt_wallet_entries WHERE user_id='{self.m[2][0]}' "
                               "AND details->>'mode'='pooled'"),
                         value("SELECT 'Seduta ' || to_char(current_date-3,'DD/MM') || ' 13:00 · 40€ divisi su 3 presenze'"))

    def test_all_empty_sessions_share_one_price(self):
        self.slot('current_date-3', '10:00')
        self.slot('current_date-3', '13:00')
        self.reconcile()
        self.assertEqual(self.costs(), {u: 500 for u, _ in self.m})
        self.assertIn('seduta senza presenze', value("SELECT DISTINCT description FROM public.pt_wallet_entries"))

    def test_person_in_two_sessions_pays_two_quotas(self):
        self.slot('current_date-3', '10:00', self.m[:3])
        self.slot('current_date-3', '13:00', [self.m[0]])
        self.reconcile()
        self.assertEqual(self.costs(), {self.m[0][0]: 4000, self.m[1][0]: 2000, self.m[2][0]: 2000})

    def test_custom_session_split_among_payers_and_forces_pooled_day(self):
        custom = self.slot('current_date-3', '10:00', self.m[:2])
        self.slot('current_date-3', '13:00', [self.m[2]])
        self.admin_call(f"SELECT public.pt_set_payers('{custom}', ARRAY['{self.m[6][0]}','{self.m[7][0]}']::uuid[], 'offerta')")
        self.reconcile()
        self.assertEqual(self.costs(), {self.m[2][0]: 4000, self.m[6][0]: 2000, self.m[7][0]: 2000})
        self.assertIn('40€ divisi tra 2 paganti', value(f"SELECT description FROM public.pt_wallet_entries WHERE user_id='{self.m[6][0]}'"))
        # Empty array returns to auto billing: day is case B again.
        self.admin_call(f"SELECT public.pt_set_payers('{custom}', '{{}}'::uuid[], null)")
        self.assertEqual(sum(self.costs().values()), 8000)
        self.assertEqual(self.costs()[self.m[6][0]], 500)

    def test_exclusion_does_not_count_toward_full_and_removes_shared_quota(self):
        s = self.slot('current_date-3', '10:00', self.m[:3])
        self.admin_call(f"SELECT public.pt_set_exclusion('{s}', '{self.m[2][0]}', true, 'infortunio')")
        self.admin_call(f"SELECT public.pt_set_exclusion('{s}', '{self.m[7][0]}', true, 'non prenotato')")
        self.reconcile()
        costs = self.costs()
        # 2 presences -> not full -> case B; 40€ among 6 members (two excluded): 667,667,667,667,666,666
        self.assertNotIn(self.m[2][0], costs)
        self.assertNotIn(self.m[7][0], costs)
        self.assertEqual(sum(costs.values()), 4000)
        eligible = [u for i, (u, _) in enumerate(self.m) if i not in (2, 7)]
        self.assertEqual([costs[u] for u in eligible], [667, 667, 667, 667, 666, 666])

    def test_cents_distribution_is_exact_and_deterministic(self):
        sql(f"DELETE FROM public.pt_memberships WHERE user_id='{self.m[7][0]}'")
        self.slot('current_date-3', '10:00')
        self.reconcile()
        costs = self.costs()
        self.assertEqual(sum(costs.values()), 4000)
        self.assertEqual([costs[u] for u, _ in self.m[:7]], [572, 572, 572, 571, 571, 571, 571])

    # Reconciliation --------------------------------------------------------
    def test_reconcile_is_idempotent_and_waits_for_day_close(self):
        self.slot('current_date-3', '10:00', self.m[:2])
        self.assertGreater(self.reconcile(), 0)
        self.assertEqual(self.reconcile(), 0)
        self.slot('current_date+3', '10:00', self.m[:2])
        self.assertEqual(self.reconcile('current_date+3'), 0)
        self.assertEqual(value('SELECT count(*) FROM public.pt_wallet_entries WHERE session_date = current_date+3'), '0')
        before = value('SELECT count(*) FROM public.pt_wallet_entries')
        self.assertEqual(value('SELECT private.pt_reconcile_recent()'), '0')
        self.assertEqual(value('SELECT count(*) FROM public.pt_wallet_entries'), before)

    def test_void_after_close_nets_to_zero_and_restore_recharges(self):
        a = self.slot('current_date-3', '10:00', self.m[:4])
        b = self.slot('current_date-3', '13:00', self.m[4:6])
        self.reconcile()
        original = self.costs()
        self.admin_call(f"SELECT public.pt_void_session('{a}', 'trainer assente')")
        self.admin_call(f"SELECT public.pt_void_session('{b}', 'trainer assente')")
        self.assertEqual(self.costs(), {})
        desc = value(f"SELECT description FROM public.pt_wallet_entries WHERE kind='adjustment' AND slot_id='{a}' "
                     f"AND user_id='{self.m[0][0]}'")
        self.assertEqual(desc, value("SELECT 'Rettifica ' || to_char(current_date-3,'DD/MM') "
                                     "|| ' 10:00 · seduta delle 10:00 annullata dall''admin: trainer assente'"))
        self.assertEqual(value("SELECT DISTINCT created_by_name FROM public.pt_wallet_entries WHERE kind='adjustment'"), 'User admin@h')
        self.assertEqual(self.reconcile(), 0)
        charges = value("SELECT count(*) FROM public.pt_wallet_entries WHERE kind='charge'")
        self.admin_call(f"SELECT public.pt_restore_session('{a}')")
        self.admin_call(f"SELECT public.pt_restore_session('{b}')")
        self.assertEqual(self.costs(), original)
        self.assertEqual(value("SELECT count(*) FROM public.pt_wallet_entries WHERE kind='charge'"), charges)

    def test_future_void_restores_capacity_and_restore_checks_bookings(self):
        s = self.slot('current_date+7', '18:00', pt=False)
        self.admin_call(f"SELECT public.pt_create_session('{s}')")
        self.assertEqual(value(f"SELECT max_capacity || '/' || min_capacity FROM public.slots WHERE id='{s}'"), '4/1')
        self.assertEqual(value(f"SELECT source || price_cents FROM public.pt_sessions WHERE slot_id='{s}'"), 'manual4000')
        self.assert_error(sql(f"SELECT public.create_booking('{s}')", self.guest, False), 'PT membership required')
        sql(f"SELECT public.create_booking('{s}')", self.m[0])
        self.admin_call(f"SELECT public.pt_void_session('{s}', 'chiuso')")
        self.assertEqual(value(f"SELECT max_capacity || '/' || min_capacity FROM public.slots WHERE id='{s}'"), '7/3')
        booking = value(f"SELECT public.create_booking('{s}')", self.guest)
        self.assert_error(self.admin_call(f"SELECT public.pt_restore_session('{s}')", ok=False), 'Slot has incompatible bookings')
        sql(f"SELECT public.cancel_booking('{booking}')", self.guest)
        self.admin_call(f"SELECT public.pt_restore_session('{s}')")
        self.assertEqual(value(f"SELECT status || max_capacity FROM public.pt_sessions JOIN public.slots ON id=slot_id WHERE id='{s}'"), 'active4')
        self.assertEqual(value(f"SELECT count(*) FROM public.bookings WHERE slot_id='{s}'"), '1')
        self.assert_error(self.admin_call(f"SELECT public.pt_void_session('{uuid.uuid4()}', 'x')", ok=False), 'Session not found')

    def test_create_session_rejects_incompatible_and_slot_full(self):
        s = self.slot('current_date+7', '18:00', [self.guest], pt=False)
        self.assert_error(self.admin_call(f"SELECT public.pt_create_session('{s}')", ok=False), 'Slot has incompatible bookings')
        full = self.slot('current_date+7', '19:00', self.m[:4])
        self.assert_error(sql(f"SELECT public.create_booking('{full}')", self.m[4], False), 'Slot full')

    def test_retroactive_membership_end_and_reenrol(self):
        self.slot('current_date-5', '10:00')
        future = self.slot('current_date+7', '10:00', [self.m[7]])
        self.reconcile('current_date-5')
        self.assertEqual(self.costs('current_date-5')[self.m[7][0]], 500)
        membership = value(f"SELECT id FROM public.pt_memberships WHERE user_id='{self.m[7][0]}'")
        self.admin_call(f"SELECT public.pt_save_membership('{membership}', '{self.m[7][0]}', current_date-60, current_date-10)")
        costs = self.costs('current_date-5')
        self.assertNotIn(self.m[7][0], costs)
        self.assertEqual(sum(costs.values()), 4000)
        self.assertEqual(sorted(costs.values()), [571] * 4 + [572] * 3)
        self.assertEqual(value(f"SELECT count(*) FROM public.bookings WHERE slot_id='{future}'"), '0')
        self.assertIn('iscrizione modificata', value(
            f"SELECT description FROM public.pt_wallet_entries WHERE user_id='{self.m[7][0]}' AND kind='adjustment'"))
        self.assert_error(self.admin_call(
            f"SELECT public.pt_save_membership(null, '{self.m[7][0]}', current_date-20, current_date-1)", ok=False),
            'Membership overlap')
        self.admin_call(f"SELECT public.pt_save_membership(null, '{self.m[7][0]}', current_date-1, null)")
        self.assertNotIn(self.m[7][0], self.costs('current_date-5'))
        self.assertEqual(value(f"SELECT is_member FROM public.pt_my_status()", self.m[7]), 't')
        sql(f"SELECT public.create_booking('{future}')", self.m[7])
        self.assert_error(self.admin_call(
            f"SELECT public.pt_save_membership(null, '{self.m[7][0]}', current_date, current_date-1)", ok=False), 'Invalid period')

    def test_price_change_only_affects_open_days(self):
        self.slot('current_date-3', '10:00')
        future = self.slot('current_date+7', '10:00')
        self.reconcile()
        self.admin_call('SELECT public.pt_update_settings(6000, 1500, 5)')
        self.assertEqual(self.reconcile(), 0)
        self.assertEqual(sum(self.costs().values()), 4000)
        self.assertEqual(value(f"SELECT price_cents FROM public.pt_sessions WHERE slot_id='{future}'"), '6000')
        self.assertEqual(value(f"SELECT max_capacity FROM public.slots WHERE id='{future}'"), '5')
        self.assert_error(self.admin_call('SELECT public.pt_update_settings(0, 1500, 4)', ok=False), 'Invalid amount')

    # Booking rules ---------------------------------------------------------
    def test_pt_booking_ignores_one_booking_per_day_rule(self):
        normal = self.slot('current_date+7', '08:00', pt=False)
        normal2 = self.slot('current_date+7', '09:00', pt=False)
        pt = self.slot('current_date+7', '18:00')
        sql(f"SELECT public.create_booking('{normal}')", self.m[0])
        sql(f"SELECT public.create_booking('{pt}')", self.m[0])
        sql(f"SELECT public.create_booking('{pt}')", self.m[1])
        sql(f"SELECT public.create_booking('{normal}')", self.m[1])
        self.assert_error(sql(f"SELECT public.create_booking('{normal2}')", self.m[1], False), 'Already booked')

    def test_concurrent_pt_bookings_cannot_overbook(self):
        pt = self.slot('current_date+7', '18:00')
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda u: sql(f"SELECT public.create_booking('{pt}')", u, False), self.m[:6]))
        self.assertEqual(sum(r.returncode == 0 for r in results), 4)
        self.assertEqual(value(f"SELECT count(*) FROM public.bookings WHERE slot_id='{pt}'"), '4')

    def test_cancel_underfilled_skips_pt_sessions(self):
        today = "(now() AT TIME ZONE 'Europe/Rome')::date"
        pt = self.slot(today, '00:01', end='23:59')
        normal = self.slot(today, '00:02', pt=False, end='23:58')
        sql('SELECT private.cancel_underfilled_slots()')
        self.assertEqual(value(f"SELECT is_cancelled FROM public.slots WHERE id='{pt}'"), 'f')
        self.assertEqual(value(f"SELECT is_cancelled FROM public.slots WHERE id='{normal}'"), 't')

    def test_schedule_generation_and_sync(self):
        sql(f"INSERT INTO public.space_time_slots(space_id,day_of_week,start_time,end_time,is_pt) "
            f"SELECT '{SPACE}', d, '18:00', '19:00', d = 2 FROM generate_series(1,7) d")
        sql('SELECT private.generate_slots(30)')
        self.assertEqual(value("SELECT count(*) = count(*) FILTER (WHERE extract(isodow FROM s.date) = 2 AND s.max_capacity = 4) "
                               "FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id WHERE p.source = 'schedule'"), 't')
        self.assertNotEqual(value('SELECT count(*) FROM public.pt_sessions'), '0')
        sql(f"UPDATE public.space_time_slots SET is_pt = (day_of_week = 3) WHERE space_id = '{SPACE}'")
        changed = int(value(f"SELECT public.pt_sync_schedule('{SPACE}')", self.admin))
        self.assertGreater(changed, 0)
        later = 'current_date + 2'  # avoid today's slot, which may already have started
        self.assertEqual(value("SELECT bool_and(extract(isodow FROM s.date) = 3 AND s.max_capacity = 4) "
                               f"FROM public.pt_sessions p JOIN public.slots s ON s.id = p.slot_id WHERE s.date >= {later}"), 't')
        self.assertEqual(value("SELECT count(*) FROM public.slots WHERE extract(isodow FROM date) = 2 "
                               f"AND max_capacity <> 7 AND date >= {later}"), '0')
        self.assertEqual(value(f"SELECT public.pt_sync_schedule('{SPACE}')", self.admin), '0')

    # Preview ---------------------------------------------------------------
    def preview(self, day, user):
        out = value(f"SELECT status, presences, mode, unit_cents, my_cents, members, next_unit_cents, day_closed "
                    f"FROM public.pt_day_preview({day})", user)
        return [line.split('|') for line in out.splitlines()]

    def test_preview_estimates_open_day(self):
        self.slot('current_date+7', '10:00', self.m[:2])
        self.slot('current_date+7', '13:00')
        rows = self.preview('current_date+7', self.m[0])
        self.assertEqual(rows[0], ['active', '2', 'shared', '500', '500', '8', '1333', 'f'])
        self.assertEqual(rows[1], ['active', '0', 'free', '', '0', '8', '1333', 'f'])
        self.assertEqual(self.preview('current_date+7', self.guest)[0][4], '')
        self.assert_error(sql('SELECT * FROM public.pt_day_preview(current_date)', self.trainer, False), 'Access denied')

    def test_preview_matches_posted_after_close(self):
        a = self.slot('current_date-3', '10:00', self.m[:2])
        b = self.slot('current_date-3', '13:00', [self.m[0], self.m[2]])
        void = self.slot('current_date-3', '15:00', [self.m[3]])
        self.admin_call(f"SELECT public.pt_void_session('{void}', 'x')")
        self.reconcile()
        for user in self.m[:4]:
            preview = dict(line.split('|') for line in value(
                "SELECT slot_id, my_cents FROM public.pt_day_preview(current_date-3)", user).splitlines())
            posted = dict(line.split('|') for line in value(
                f"SELECT s, coalesce((SELECT -sum(amount_cents) FROM public.pt_wallet_entries w "
                f"WHERE w.user_id='{user[0]}' AND w.slot_id=s), 0) FROM unnest(ARRAY['{a}','{b}','{void}']::uuid[]) s").splitlines())
            self.assertEqual(preview, posted)
        self.assertEqual(self.preview('current_date-3', self.m[0])[2][2], 'voided')
        self.assertEqual(self.preview('current_date-3', self.m[0])[0][7], 't')

    def test_admin_sessions_charges(self):
        self.slot('current_date-3', '10:00', self.m[:4])
        self.slot('current_date+3', '10:00', self.m[:4])
        self.reconcile()
        out = value("SELECT date - current_date, day_closed, mode, total_cents, jsonb_array_length(charges), "
                    "jsonb_array_length(participants) FROM public.pt_admin_sessions(current_date-5, current_date+5)", self.admin)
        self.assertEqual(out.splitlines(), ['-3|t|pooled|4000|4|4', '3|f|pooled|4000|4|4'])
        self.assert_error(sql("SELECT * FROM public.pt_admin_sessions(current_date, current_date+200)", self.admin, False),
                          'Invalid date range')

    # Roles, RLS and wallet -------------------------------------------------
    def test_rls_wallet_and_memberships(self):
        self.slot('current_date-3', '10:00', self.m[:2])
        self.reconcile()
        self.admin_call(f"SELECT public.pt_add_wallet_entry('{self.m[0][0]}', 5000, 'topup', 'contanti')")
        self.assertEqual(value('SELECT count(DISTINCT user_id) FROM public.pt_wallet_entries', self.m[0]), '1')
        self.assertEqual(value('SELECT count(*) FROM public.pt_memberships', self.m[0]), '1')
        self.assertEqual(value('SELECT count(*) FROM public.pt_wallet_entries', self.admin), '9')
        self.assertEqual(value('SELECT balance_cents FROM public.pt_my_status()', self.m[0]), '4500')
        for statement in [
            f"INSERT INTO public.pt_wallet_entries(user_id,amount_cents,kind,description) VALUES ('{self.m[0][0]}',100000,'topup','x')",
            "UPDATE public.pt_wallet_entries SET amount_cents = 1",
            "DELETE FROM public.pt_wallet_entries",
            f"INSERT INTO public.pt_memberships(user_id,valid_from) VALUES ('{self.guest[0]}', current_date)",
            "UPDATE public.pt_sessions SET status = 'voided'",
            "SELECT private.pt_reconcile_recent()",
        ]:
            self.assertNotEqual(sql(statement, self.m[0], False).returncode, 0, statement)
        self.assertNotEqual(sql("UPDATE public.pt_wallet_entries SET amount_cents = 1", self.admin, False).returncode, 0)
        self.assert_error(self.admin_call(f"SELECT public.pt_add_wallet_entry('{self.m[0][0]}', -5, 'topup', null)", ok=False),
                          'Invalid amount')
        self.assert_error(self.admin_call(f"SELECT public.pt_add_wallet_entry('{self.m[0][0]}', 0, 'manual', null)", ok=False),
                          'Invalid amount')
        self.assertEqual(value('SELECT count(*) FROM public.pt_settings', self.m[0]), '1')
        self.assertEqual(value('SELECT count(*) FROM public.pt_trainers', self.m[0]), '0')

    def test_trainer_access(self):
        external = (str(uuid.uuid4()), 'other.coach@external.example')
        self.assertNotEqual(sql(f"INSERT INTO auth.users(id,email) VALUES ('{external[0]}','{external[1]}')", ok=False).returncode, 0)
        self.admin_call(f"INSERT INTO public.pt_trainers(email) VALUES ('{external[1]}')")
        sql(f"INSERT INTO auth.users(id,email) VALUES ('{external[0]}','{external[1]}')")
        self.assertEqual(value('SELECT public.is_allowed() AND public.is_trainer()', external), 't')
        self.assertEqual(value('SELECT public.is_trainer()', self.m[0]), 'f')
        s = self.slot('current_date+2', '10:00', self.m[:2])
        out = value('SELECT status, participants FROM public.pt_trainer_sessions(current_date, current_date+7)', self.trainer)
        status, participants = out.split('|')
        self.assertEqual(status, 'active')
        self.assertEqual([p['name'] for p in json.loads(participants)], [self.m[0][1], self.m[1][1]])
        self.assertEqual(value('SELECT count(*) FROM public.pt_trainer_sessions(current_date, current_date+7)', self.admin), '1')
        self.assert_error(sql('SELECT * FROM public.pt_trainer_sessions(current_date, current_date+7)', self.m[0], False), 'Access denied')
        self.assert_error(sql(f"SELECT public.pt_void_session('{s}', 'x')", self.trainer, False), 'Admin required')
        self.assert_error(sql('SELECT * FROM public.pt_admin_sessions(current_date, current_date+7)', self.trainer, False), 'Admin required')
        normal = self.slot('current_date+2', '12:00', pt=False)
        self.assert_error(sql(f"SELECT public.create_booking('{normal}')", self.trainer, False), 'Access denied')

    def test_non_admin_denied_on_admin_rpcs(self):
        s = self.slot('current_date+2', '10:00')
        u = self.m[1][0]
        calls = [
            'SELECT * FROM public.admin_list_users()',
            f"SELECT public.pt_save_membership(null, '{u}', current_date, null)",
            f"SELECT public.pt_delete_membership('{uuid.uuid4()}')",
            f"SELECT public.pt_add_wallet_entry('{u}', 100, 'topup', null)",
            f"SELECT public.pt_void_session('{s}', 'x')",
            f"SELECT public.pt_restore_session('{s}')",
            f"SELECT public.pt_create_session('{s}')",
            f"SELECT public.pt_set_exclusion('{s}', '{u}', true, null)",
            f"SELECT public.pt_set_payers('{s}', ARRAY['{u}']::uuid[], null)",
            'SELECT public.pt_update_settings(1, 1, 1)',
            f"SELECT public.pt_sync_schedule('{SPACE}')",
            'SELECT * FROM public.pt_admin_sessions(current_date, current_date)',
            'SELECT * FROM public.pt_low_balances()',
        ]
        for call in calls:
            result = sql(call, self.m[0], False)
            self.assert_error(result, 'Admin required')
            self.assertIn('42501', sql(f"\\set VERBOSITY verbose\n{call}", self.m[0], False).stderr)
        self.assertNotEqual(sql('SET ROLE anon; SELECT public.is_trainer()', ok=False).returncode, 0)

    def test_admin_users_and_low_balances(self):
        self.admin_call(f"SELECT public.pt_add_wallet_entry('{self.m[0][0]}', 5000, 'topup', null)")
        self.admin_call(f"SELECT public.pt_add_wallet_entry('{self.guest[0]}', -300, 'manual', 'debito')")
        sql(f"UPDATE auth.users SET last_sign_in_at = now() WHERE id = '{self.m[1][0]}'")
        users = {line.split('|')[0]: line.split('|')[1:] for line in value(
            "SELECT user_id, is_admin, is_trainer, pt_active, balance_cents, last_sign_in_at IS NOT NULL "
            "FROM public.admin_list_users()", self.admin).splitlines()}
        self.assertEqual(users[self.m[0][0]], ['f', 'f', 't', '5000', 'f'])
        self.assertEqual(users[self.m[1][0]], ['f', 'f', 't', '0', 't'])
        self.assertEqual(users[self.admin[0]][:2], ['t', 'f'])
        self.assertEqual(users[self.trainer[0]][:2], ['f', 't'])
        low = value('SELECT user_id, balance_cents FROM public.pt_low_balances()', self.admin).splitlines()
        self.assertEqual(low[0], f'{self.guest[0]}|-300')
        ids = [line.split('|')[0] for line in low]
        self.assertNotIn(self.m[0][0], ids)
        self.assertNotIn(self.admin[0], ids)
        self.assertEqual(len(ids), 8)


if __name__ == '__main__':
    unittest.main(verbosity=2)
