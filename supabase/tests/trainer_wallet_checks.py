"""Trainer assignment, compensation, cash payments and authorization on real PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
import unittest
import uuid
import json
import pt_checks
from pt_checks import sql, value


class TrainerWalletChecks(unittest.TestCase):
    setUp = pt_checks.PersonalTrainerChecks.setUp
    slot = pt_checks.PersonalTrainerChecks.slot

    def trainer_id(self):
        return value("SELECT id FROM public.pt_trainers WHERE email='coach@trainers.example'")

    def balance(self, trainer=None):
        return int(value(f"SELECT coalesce(sum(amount_cents),0) FROM public.pt_trainer_wallet_entries WHERE trainer_id='{trainer or self.trainer_id()}'"))

    def assign(self, slot, trainer=None, fee=4000):
        sql(f"SELECT public.pt_set_session_trainer('{slot}', '{trainer or self.trainer_id()}', {fee}, 'test change')", self.admin)

    def test_fixed_compensation_is_independent_of_participant_charges(self):
        first = self.slot('current_date-3', '10:00')
        self.slot('current_date-3', '13:00')
        self.assertEqual(self.balance(), 8000)
        sql('SELECT private.pt_reconcile_recent()')
        self.assertEqual(value('SELECT -sum(amount_cents) FROM public.pt_wallet_entries'), '4000')
        self.assertEqual(self.balance(), 8000)
        self.assertEqual(value('SELECT count(*) FROM public.pt_trainer_wallet_entries'), '2')
        sql(f"SELECT public.pt_void_session('{first}', 'cancelled')", self.admin)
        self.assertEqual(self.balance(), 4000)
        sql(f"SELECT public.pt_restore_session('{first}')", self.admin)
        self.assertEqual(self.balance(), 8000)

    def test_accrues_at_session_end_without_waiting_for_other_sessions(self):
        if value("SELECT (clock_timestamp() AT TIME ZONE 'Europe/Rome')::time < time '00:03'") == 't':
            self.skipTest('Midnight boundary: no completed same-day session yet')
        slot = self.slot('private.pt_today()', '00:00', end='00:01')
        self.slot('private.pt_today()', '23:58', end='23:59')
        if value('SELECT private.pt_day_closed(private.pt_today())') == 't':
            self.skipTest('Last minute of the day')
        self.assertEqual(self.balance(), 4000)
        self.assertEqual(value(f"SELECT fee_cents FROM public.pt_session_trainers WHERE slot_id='{slot}'"), '4000')

    def test_future_sessions_do_not_accrue_and_late_jobs_recover(self):
        future = self.slot('current_date+3', '10:00')
        self.assertEqual(self.balance(), 0)
        sql('SELECT private.pt_reconcile_trainers()')
        self.assertEqual(self.balance(), 0)
        # Simulate the clock advancing while the worker was unavailable.
        sql('ALTER TABLE public.slots DISABLE TRIGGER pt_trainer_slot_changed')
        sql(f"UPDATE public.slots SET date=current_date-30 WHERE id='{future}'")
        sql('ALTER TABLE public.slots ENABLE TRIGGER pt_trainer_slot_changed')
        sql('SELECT private.pt_reconcile_recent()')
        sql('SELECT private.pt_reconcile_recent()')
        self.assertEqual(self.balance(), 4000)
        self.assertEqual(value('SELECT count(*) FROM public.pt_trainer_wallet_entries'), '1')

    def test_change_trainer_and_fee_retains_history(self):
        slot = self.slot('current_date-3', '10:00')
        other = value("SELECT public.pt_add_trainer('other@example.org', 5500)", self.admin)
        self.assign(slot, other, 5500)
        self.assertEqual(self.balance(), 0)
        self.assertEqual(self.balance(other), 5500)
        self.assign(slot, other, 6000)
        self.assign(slot, other, 6000)
        self.assertEqual(self.balance(other), 6000)
        self.assertEqual(value('SELECT count(*) FROM public.pt_trainer_wallet_entries'), '4')
        self.assertEqual(value(f"SELECT count(*) FROM public.pt_trainer_sessions(current_date-7,current_date) WHERE slot_id='{slot}'", self.trainer), '0')
        sql(f"SELECT public.pt_void_session('{slot}', 'cancelled')", self.admin)
        self.assertEqual(self.balance(other), 0)

    def test_account_rate_changes_only_new_sessions(self):
        first = self.slot('current_date+3', '10:00')
        sql(f"SELECT public.pt_save_trainer_rate('{self.trainer_id()}', 5500)", self.admin)
        second = self.slot('current_date+3', '13:00')
        self.assertEqual(value(f"SELECT fee_cents FROM public.pt_session_trainers WHERE slot_id='{first}'"), '4000')
        self.assertEqual(value(f"SELECT fee_cents FROM public.pt_session_trainers WHERE slot_id='{second}'"), '5500')
        self.assertEqual(self.balance(), 0)

    def test_payment_idempotency_advance_and_reversal(self):
        request = str(uuid.uuid4())
        # Public calls cannot access private.pt_today(), so pass a public date literal.
        statement = f"SELECT public.pt_record_trainer_payment('{self.trainer_id()}', 9000, current_date-1, 'cash', 'anticipo', '{request}')"
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(lambda _: value(statement, self.admin), range(2)))
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(self.balance(), -9000)
        self.slot('current_date-3', '10:00')
        self.assertEqual(self.balance(), -5000)
        for _ in range(2):
            sql(f"SELECT public.pt_reverse_trainer_payment('{ids[0]}', 'errato')", self.admin)
        self.assertEqual(self.balance(), 4000)
        totals = value('SELECT earned_cents, paid_cents, balance_cents FROM public.pt_trainer_accounts()', self.admin)
        self.assertEqual(totals, '4000|0|4000')
        conflict = sql(statement.replace('9000', '8000'), self.admin, False)
        self.assertNotEqual(conflict.returncode, 0)
        self.assertIn('Request already used', conflict.stderr)

    def test_wallet_privacy_and_direct_writes_are_denied(self):
        slot = self.slot('current_date-3', '10:00')
        trainer = self.trainer_id()
        statements = [
            'SELECT * FROM public.pt_trainer_accounts()',
            'SELECT * FROM public.pt_trainer_session_details(current_date-7,current_date)',
            f"SELECT public.pt_set_session_trainer('{slot}','{trainer}',100,'x')",
            f"SELECT public.pt_create_assigned_session('{slot}','{trainer}',100)",
            f"SELECT public.pt_set_trainer_defaults('{trainer}')",
            f"SELECT public.pt_save_trainer_rate('{trainer}',100)",
            "SELECT public.pt_add_trainer('new@example.org',100)",
            f"SELECT public.pt_record_trainer_payment('{trainer}',100,current_date-1,'cash','x','{uuid.uuid4()}')",
            f"SELECT public.pt_reverse_trainer_payment('{uuid.uuid4()}','x')",
        ]
        for user in [self.trainer, self.m[0]]:
            for statement in statements:
                denied = sql(statement, user, False)
                self.assertNotEqual(denied.returncode, 0, statement)
                self.assertIn('Admin required', denied.stderr)
            for table in ['pt_trainer_wallet_entries', 'pt_trainer_rates', 'pt_session_trainers', 'pt_trainer_settings']:
                self.assertEqual(value(f'SELECT count(*) FROM public.{table}', user), '0')
        for statement in statements:
            self.assertNotEqual(sql('SET ROLE anon; '+statement, ok=False).returncode, 0)
        for user in [self.admin, self.trainer, self.m[0]]:
            self.assertNotEqual(sql('DELETE FROM public.pt_trainer_wallet_entries', user, False).returncode, 0)
            self.assertNotEqual(sql('UPDATE public.pt_trainer_wallet_entries SET amount_cents=1', user, False).returncode, 0)
            self.assertNotEqual(sql(f"INSERT INTO public.pt_trainer_wallet_entries(trainer_id,amount_cents,kind,occurred_on,description) VALUES ('{trainer}',1,'earning',current_date,'fake')", user, False).returncode, 0)

    def test_own_wallet_is_private_and_requires_a_trainer(self):
        self.slot('current_date-3', '10:00')
        other = value("SELECT public.pt_add_trainer('other@example.org', 5500)", self.admin)
        slot = self.slot('current_date-3', '13:00')
        self.assign(slot, other, 5500)
        own = json.loads(value('SELECT public.pt_my_trainer_wallet()', self.trainer))
        self.assertEqual(own['earned_cents'], 4000)
        self.assertEqual(own['paid_cents'], 0)
        self.assertEqual(own['balance_cents'], 4000)
        self.assertTrue(all(e['trainer_id'] == self.trainer_id() for e in own['entries']))
        # Even admins must have a trainer account to use this personal endpoint.
        for user in [self.m[0], self.guest, self.admin]:
            denied = sql('SELECT public.pt_my_trainer_wallet()', user, False)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('Trainer required', denied.stderr)
        self.assertNotEqual(sql('SET ROLE anon; SELECT public.pt_my_trainer_wallet()', ok=False).returncode, 0)
        self.assertNotEqual(sql(f"SELECT public.pt_my_trainer_wallet('{other}')", self.trainer, False).returncode, 0)
        # Having both roles never exposes other trainers through the personal RPC.
        sql(f"INSERT INTO public.admins(email) VALUES ('{self.trainer[1]}')")
        self.assertEqual(json.loads(value('SELECT public.pt_my_trainer_wallet()', self.trainer)), own)

    def test_own_wallet_accrues_on_read_and_matches_admin_after_reversals(self):
        future = self.slot('current_date+3', '10:00')
        sql('ALTER TABLE public.slots DISABLE TRIGGER pt_trainer_slot_changed')
        sql(f"UPDATE public.slots SET date=current_date-3 WHERE id='{future}'")
        sql('ALTER TABLE public.slots ENABLE TRIGGER pt_trainer_slot_changed')
        self.assertEqual(self.balance(), 0)
        payment = value(f"SELECT public.pt_record_trainer_payment('{self.trainer_id()}',6000,current_date-1,'cash','advance','{uuid.uuid4()}')", self.admin)
        # Posting a payment does not run the accrual job.
        first = json.loads(value('SELECT public.pt_my_trainer_wallet()', self.trainer))
        self.assertEqual((first['earned_cents'], first['paid_cents'], first['balance_cents']), (4000, 6000, -2000))
        self.assertEqual(json.loads(value('SELECT public.pt_my_trainer_wallet()', self.trainer)), first)
        sql(f"SELECT public.pt_reverse_trainer_payment('{payment}','wrong payment')", self.admin)
        sql(f"SELECT public.pt_void_session('{future}','cancelled')", self.admin)
        own = json.loads(value('SELECT public.pt_my_trainer_wallet()', self.trainer))
        self.assertEqual((own['earned_cents'], own['paid_cents'], own['balance_cents']), (0, 0, 0))
        self.assertEqual(len(own['entries']), 4)
        self.assertEqual(value('SELECT earned_cents,paid_cents,balance_cents FROM public.pt_trainer_accounts()', self.admin), '0|0|0')

    def test_own_wallet_empty_and_future_sessions_have_zero_totals(self):
        self.slot('current_date+3', '10:00')
        own = json.loads(value('SELECT public.pt_my_trainer_wallet()', self.trainer))
        self.assertEqual(own, {'earned_cents': 0, 'paid_cents': 0, 'balance_cents': 0, 'entries': []})

    def test_legacy_history_requires_explicit_assignment(self):
        sql('ALTER TABLE public.pt_sessions DISABLE TRIGGER pt_session_trainer_created')
        old = self.slot('current_date-30', '10:00')
        future = self.slot('current_date+3', '10:00')
        sql('ALTER TABLE public.pt_sessions ENABLE TRIGGER pt_session_trainer_created')
        sql(f"SELECT public.pt_set_trainer_defaults('{self.trainer_id()}')", self.admin)
        self.assertEqual(value(f"SELECT count(*) FROM public.pt_session_trainers WHERE slot_id='{future}'"), '1')
        self.assertEqual(value(f"SELECT count(*) FROM public.pt_session_trainers WHERE slot_id='{old}'"), '0')
        self.assertEqual(self.balance(), 0)
        self.assign(old, fee=4500)
        self.assertEqual(self.balance(), 4500)

    def test_new_sessions_require_trainer_but_manual_assignment_needs_no_default(self):
        sql('UPDATE public.pt_trainer_settings SET default_trainer_id=NULL')
        slot = self.slot('current_date+3', '10:00', pt=False)
        denied = sql(f"SELECT public.pt_create_session('{slot}')", self.admin, False)
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('Trainer required', denied.stderr)
        sql(f"SELECT public.pt_create_assigned_session('{slot}','{self.trainer_id()}',3500)", self.admin)
        self.assertEqual(value(f"SELECT fee_cents FROM public.pt_session_trainers WHERE slot_id='{slot}'"), '3500')

    def test_schedule_waits_for_default_and_uses_account_rate(self):
        sql('UPDATE public.pt_trainer_settings SET default_trainer_id=NULL')
        space = pt_checks.SPACE
        sql(f"INSERT INTO public.space_time_slots(space_id,day_of_week,start_time,end_time,is_pt) SELECT '{space}',d,'18:00','19:00',true FROM generate_series(1,7) d")
        sql('SELECT private.generate_slots(7)')
        self.assertEqual(value('SELECT count(*) FROM public.pt_sessions'), '0')
        sql(f"SELECT public.pt_save_trainer_rate('{self.trainer_id()}',4750)", self.admin)
        sql(f"SELECT public.pt_set_trainer_defaults('{self.trainer_id()}')", self.admin)
        self.assertGreater(int(value('SELECT count(*) FROM public.pt_sessions')), 0)
        self.assertEqual(value('SELECT count(*) FROM public.pt_sessions p LEFT JOIN public.pt_session_trainers a ON a.slot_id=p.slot_id WHERE a.slot_id IS NULL'), '0')
        self.assertEqual(value('SELECT bool_and(fee_cents=4750) FROM public.pt_session_trainers'), 't')

    def test_concurrent_reconciliation_and_assignment_do_not_duplicate_earnings(self):
        slot = self.slot('current_date-3', '10:00')
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda op: sql(op[0], op[1]), [
                ('SELECT private.pt_reconcile_trainers()', None),
                ('SELECT private.pt_reconcile_trainers()', None),
                (f"SELECT public.pt_set_session_trainer('{slot}', '{self.trainer_id()}', 5500, 'concurrent change')", self.admin),
            ]))
        self.assertTrue(all(r.returncode == 0 for r in results))
        self.assign(slot, fee=5500)
        self.assertEqual(self.balance(), 5500)
        self.assertEqual(value('SELECT count(*) FROM public.pt_trainer_wallet_entries'), '2')

    def test_invalid_payments_and_assignments_are_rejected(self):
        trainer = self.trainer_id()
        for amount, date, method, note in [(0,'current_date-1','cash','x'),(-1,'current_date-1','cash','x'),(1,'current_date+1','cash','x'),(1,'NULL','cash','x'),(1,'current_date-1','invalid','x'),(1,'current_date-1','cash',' ')]:
            denied = sql(f"SELECT public.pt_record_trainer_payment('{trainer}',{amount},{date},'{method}','{note}','{uuid.uuid4()}')", self.admin, False)
            self.assertNotEqual(denied.returncode, 0)
        slot = self.slot('current_date-3', '10:00')
        for trainer_id, fee, reason in [('NULL',100,"'x'"),(f"'{trainer}'",-1,"'x'"),(f"'{trainer}'",100,"''")]:
            self.assertNotEqual(sql(f"SELECT public.pt_set_session_trainer('{slot}',{trainer_id},{fee},{reason})", self.admin, False).returncode, 0)
        self.assertEqual(self.balance(), 4000)

    def test_slot_cancellation_reversal_and_deleted_slot_history(self):
        slot = self.slot('current_date-3', '10:00')
        sql(f"UPDATE public.slots SET is_cancelled=true WHERE id='{slot}'")
        self.assertEqual(self.balance(), 0)
        sql(f"UPDATE public.slots SET is_cancelled=false WHERE id='{slot}'")
        self.assertEqual(self.balance(), 4000)
        sql(f"DELETE FROM public.slots WHERE id='{slot}'")
        self.assertEqual(self.balance(), 4000)
        self.assertEqual(value('SELECT bool_and(slot_id IS NULL AND session_date IS NOT NULL) FROM public.pt_trainer_wallet_entries'), 't')
        self.assertNotEqual(sql(f"DELETE FROM public.pt_trainers WHERE id='{self.trainer_id()}'", self.admin, False).returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
