"""Exercise real PostgreSQL permissions, booking transactions and race conditions."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import subprocess
import unittest
import uuid

CONTAINER = os.environ['GYM_TEST_CONTAINER']


def sql(statement, user=None, ok=True):
    if user:
        claims = json.dumps({'sub': user[0], 'email': user[1]}).replace("'", "''")
        statement = f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{claims}'; {statement}; COMMIT;"
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-U', 'postgres', '-Atq',
                             '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result


class DatabaseChecks(unittest.TestCase):
    def setUp(self):
        sql("TRUNCATE public.bookings, public.slots, public.space_time_slots, public.spaces, auth.users, public.admins, public.allowed_domains, public.allowed_emails CASCADE;")
        sql("INSERT INTO public.allowed_domains(domain) VALUES ('humans.tech'); INSERT INTO public.admins(email) VALUES ('admin@humans.tech');")
        self.users = [(str(uuid.uuid4()), f'user{i}@humans.tech') for i in range(3)]
        self.admin = (str(uuid.uuid4()), 'admin@humans.tech')
        for user in [*self.users, self.admin]:
            sql(f"INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ('{user[0]}','{user[1]}','{{\"full_name\":\"Tester\"}}');")
        self.space = str(uuid.uuid4())
        sql(f"INSERT INTO public.spaces(id,name,max_capacity,min_capacity) VALUES ('{self.space}','Test',1,1);")
        self.slots = [str(uuid.uuid4()) for _ in range(2)]
        for i, slot in enumerate(self.slots):
            sql(f"INSERT INTO public.slots(id,space_id,date,start_time,end_time,max_capacity,min_capacity) VALUES ('{slot}','{self.space}',current_date+7,'{10+i}:00','{11+i}:00',1,1);")

    def book(self, user, slot=None, ok=True):
        return sql(f"SELECT public.create_booking('{slot or self.slots[0]}')", user, ok)

    def test_admin_policy_does_not_recurse(self):
        self.assertEqual(sql('SELECT public.is_admin()', self.admin).stdout.strip(), 't')
        self.assertEqual(sql('SELECT count(*) FROM public.admins', self.users[0]).stdout.strip(), '0')

    def test_signup_and_revocation_are_enforced_in_database(self):
        denied = sql(f"INSERT INTO auth.users(id,email) VALUES ('{uuid.uuid4()}','stranger@elsewhere.test')", ok=False)
        self.assertNotEqual(denied.returncode, 0)
        sql("DELETE FROM public.allowed_domains")
        self.assertEqual(sql('SELECT public.is_allowed()', self.users[0]).stdout.strip(), 'f')
        self.assertNotEqual(self.book(self.users[0], ok=False).returncode, 0)
        self.assertEqual(sql('SELECT count(*) FROM public.spaces', self.users[0]).stdout.strip(), '0')

    def test_whitelisted_guest_can_join(self):
        guest = (str(uuid.uuid4()), 'guest@example.org')
        sql("INSERT INTO public.allowed_emails(email) VALUES ('guest@example.org')")
        sql(f"INSERT INTO auth.users(id,email) VALUES ('{guest[0]}','{guest[1]}')")
        self.assertEqual(sql('SELECT public.is_allowed()', guest).stdout.strip(), 't')

    def test_cannot_write_bookings_directly_or_impersonate(self):
        result = sql(f"INSERT INTO public.bookings(slot_id,user_id,user_email,user_name) VALUES ('{self.slots[0]}','{self.users[1][0]}','fake','Fake')", self.users[0], False)
        self.assertNotEqual(result.returncode, 0)
        self.book(self.users[0])
        self.assertEqual(sql('SELECT user_email FROM public.bookings', self.users[0]).stdout.strip(), self.users[0][1])

    def test_booker_summary_does_not_expose_private_rows(self):
        self.book(self.users[0])
        self.assertEqual(sql('SELECT count(*) FROM public.bookings', self.users[1]).stdout.strip(), '0')
        self.assertEqual(sql(f"SELECT count(*) FROM public.get_slot_bookers(ARRAY['{self.slots[0]}']::uuid[])", self.users[1]).stdout.strip(), '1')

    def test_concurrent_requests_cannot_overbook(self):
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda u: self.book(u, ok=False), self.users))
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertEqual(sql('SELECT count(*) FROM public.bookings').stdout.strip(), '1')

    def test_concurrent_requests_cannot_book_two_slots_same_day(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda s: self.book(self.users[0], s, False), self.slots))
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)

    def test_owner_can_cancel_but_other_users_cannot(self):
        booking = self.book(self.users[0]).stdout.strip()
        self.assertNotEqual(sql(f"SELECT public.cancel_booking('{booking}')", self.users[1], False).returncode, 0)
        sql(f"SELECT public.cancel_booking('{booking}')", self.users[0])
        self.assertEqual(sql('SELECT count(*) FROM public.bookings').stdout.strip(), '0')

    def test_anonymous_and_non_admin_cannot_generate_slots(self):
        self.assertNotEqual(sql('SET ROLE anon; SELECT public.generate_slots(30)', ok=False).returncode, 0)
        self.assertNotEqual(sql('SELECT public.generate_slots(30)', self.users[0], False).returncode, 0)
        sql('SELECT public.generate_slots(30)', self.admin)

    def test_cutoff_and_underfilled_cancellation(self):
        slot = self.slots[0]
        sql(f"UPDATE public.slots SET date=(now() AT TIME ZONE 'Europe/Rome')::date, start_time='00:01', end_time='23:59' WHERE id='{slot}'")
        self.assertNotEqual(self.book(self.users[0], ok=False).returncode, 0)
        sql('SELECT private.cancel_underfilled_slots()')
        self.assertEqual(sql(f"SELECT is_cancelled FROM public.slots WHERE id='{slot}'").stdout.strip(), 't')

    def test_generation_idempotence_and_holidays(self):
        sql(f"INSERT INTO public.space_time_slots(space_id,day_of_week,start_time,end_time) SELECT '{self.space}', d, '08:00','09:00' FROM generate_series(1,7) d")
        sql('SELECT private.generate_slots(90)')
        before = sql('SELECT count(*) FROM public.slots').stdout
        sql('SELECT private.generate_slots(90)')
        self.assertEqual(before, sql('SELECT count(*) FROM public.slots').stdout)
        self.assertEqual(sql("SELECT public.is_italian_holiday('2027-03-29')").stdout.strip(), 't')
        self.assertEqual(sql("SELECT public.easter_date(2027)").stdout.strip(), '2027-03-28')


if __name__ == '__main__':
    unittest.main(verbosity=2)
