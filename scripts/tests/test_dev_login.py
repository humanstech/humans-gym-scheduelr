import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from bundle import public_config
from stack import DEV_PERSONAS, Stack, read_env, require_local, write_dev_env

spec = importlib.util.spec_from_file_location('make_env', ROOT / 'scripts/make-env.py')
make_env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_env)

LOCAL = {'SUPABASE_PUBLIC_URL': 'http://localhost:8080', 'SITE_URL': 'http://localhost:8080',
         'ANON_KEY': 'public-anon', 'SERVICE_ROLE_KEY': 'service', 'ADMIN_EMAIL': 'Marco.Ciotoli@humans.tech',
         'DEV_LOGIN_PASSWORD': 'p' * 32}


class DevLoginNeverShipsTests(unittest.TestCase):
    def test_flag_is_set_only_by_the_local_overlay(self):
        for name in ['scripts/bundle.py', 'scripts/production.py', 'deploy/compose.yml', '.github/workflows/ci.yml']:
            path = ROOT / name
            if path.exists():
                self.assertNotIn('DEV_LOGIN', path.read_text(), name)
        self.assertIn('VITE_DEV_LOGIN: "true"', (ROOT / 'deploy/local.yml').read_text())
        # Declared without a default: unset unless a build passes it explicitly.
        self.assertRegex((ROOT / 'Dockerfile').read_text(), r'(?m)^ARG VITE_DEV_LOGIN$')

    def test_local_overlay_pins_mailpit(self):
        local = (ROOT / 'deploy/local.yml').read_text()
        self.assertIn('GOTRUE_SMTP_HOST: mailpit', local)
        self.assertIn('GOTRUE_SMTP_PORT: 1025', local)

    def test_development_bundle_requires_localhost_backend(self):
        production = {'SUPABASE_PUBLIC_URL': 'https://gym.humans.tech', 'ANON_KEY': 'public-anon'}
        self.assertEqual(public_config(production, development=False)[0], 'https://gym.humans.tech')
        with self.assertRaisesRegex(ValueError, 'localhost backend'):
            public_config(production, development=True)
        self.assertEqual(public_config(LOCAL, development=True)[0], 'http://localhost:8080')

    def test_personas_match_the_login_panel(self):
        ui = (ROOT / 'src/components/DevLogin.tsx').read_text()
        ui_emails = re.findall(r"email: '([^']+)'", ui)
        expected = [p['email'] or make_env.generate(local=True)['ADMIN_EMAIL'] for p in DEV_PERSONAS]
        self.assertEqual(ui_emails, expected)


class LocalEnvTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_only_local_env_gets_a_dev_password(self):
        self.assertGreaterEqual(len(make_env.generate(local=True)['DEV_LOGIN_PASSWORD']), 24)
        self.assertNotIn('DEV_LOGIN_PASSWORD', make_env.generate(local=False))

    def test_add_missing_keeps_existing_secrets(self):
        path = self.root / '.env.stack.local'
        path.write_text('SUPABASE_PUBLIC_URL=http://localhost:8080\nJWT_SECRET=keep')
        self.assertEqual(make_env.add_missing(path), ['ADDITIONAL_REDIRECT_URLS', 'DEV_LOGIN_PASSWORD'])
        env = read_env(path)
        self.assertEqual(env['JWT_SECRET'], 'keep')
        self.assertIn('http://localhost:5173/auth/callback', env['ADDITIONAL_REDIRECT_URLS'])
        password = env['DEV_LOGIN_PASSWORD']
        self.assertEqual(make_env.add_missing(path), [])
        self.assertEqual(read_env(path)['DEV_LOGIN_PASSWORD'], password)

    def test_add_missing_refuses_remote_env(self):
        path = self.root / '.env.production.local'
        path.write_text('SUPABASE_PUBLIC_URL=https://gym.humans.tech\n')
        with self.assertRaises(SystemExit):
            make_env.add_missing(path)
        self.assertNotIn('DEV_LOGIN_PASSWORD', path.read_text())

    def test_require_local(self):
        require_local(LOCAL)
        with self.assertRaisesRegex(ValueError, 'SITE_URL'):
            require_local({**LOCAL, 'SITE_URL': 'https://gym.humans.tech'})

    def test_dev_env_keeps_other_lines_and_no_service_key(self):
        path = self.root / '.env.local'
        path.write_text('VITE_SUPABASE_URL=https://old\nCUSTOM=1\n')
        write_dev_env(LOCAL, path)
        env = read_env(path)
        self.assertEqual(env, {'CUSTOM': '1', 'VITE_SUPABASE_URL': 'http://localhost:8080',
                               'VITE_SUPABASE_ANON_KEY': 'public-anon', 'VITE_DEV_LOGIN': 'true',
                               'VITE_DEV_LOGIN_PASSWORD': 'p' * 32})
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
        self.assertNotIn('service', path.read_text())


class FakeAuth:
    def __init__(self, existing, reject=()):
        self.existing, self.reject, self.calls = existing, reject, []

    def users(self):
        self.calls.append(('users',))
        return dict(self.existing)

    def request(self, method, path, body=None):
        self.calls.append((method, path, body))
        if body and body.get('email') in self.reject:
            raise RuntimeError('HTTP 500 Database error saving new user')
        return {}


class DevUsersTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / 'supabase/dev').mkdir(parents=True)
        self.env_file = self.root / '.env'
        self.env_file.write_text(''.join(f'{k}={v}\n' for k, v in LOCAL.items()))
        self.log = []

    def stack(self, failing=()):
        stack = Stack(self.root, self.env_file, 'gym-test')
        def sql(content, *args):
            self.log.append(('sql', content.strip(), args))
            if content.strip() in failing:
                raise subprocess.CalledProcessError(3, 'psql', stderr='ERROR:  relation "pt_trainers" does not exist')
        stack.sql = sql
        return stack

    def test_order_idempotency_and_optional_trainer(self):
        for name in ['10_personal_trainer.sql', '00_trainer_access.sql']:
            (self.root / 'supabase/dev' / name).write_text(name)
        auth = FakeAuth({'marco.ciotoli@humans.tech': 'admin-id', 'anna.rossi@humans.tech': 'anna-id'},
                        reject={'trainer.pt@example.com'})
        stack = self.stack(failing={'00_trainer_access.sql'})
        original = stack.sql
        def tracking(content, *args):
            self.log.append(('users_done', len([c for c in auth.calls if c[0] == 'POST'])))
            return original(content, *args)
        stack.sql = tracking
        created = stack.dev_users(auth=auth)
        sql_runs = [entry for entry in self.log if entry[0] == 'sql']
        self.assertEqual([entry[1] for entry in sql_runs], ['00_trainer_access.sql', '10_personal_trainer.sql'])
        self.assertIn('admin_email=marco.ciotoli@humans.tech', sql_runs[0][2])
        self.assertIn('--single-transaction', sql_runs[0][2])
        # 00_ before any user is created, the rest after all of them.
        self.assertEqual([entry[1] for entry in self.log if entry[0] == 'users_done'], [0, 4])
        self.assertNotIn('trainer.pt@example.com', created)
        self.assertEqual(len(created), len(DEV_PERSONAS) - 1)
        admin_update = next(call for call in auth.calls if call[:2] == ('PUT', '/users/admin-id'))
        self.assertEqual(admin_update[2], {'password': 'p' * 32, 'email_confirm': True})
        anna = next(call for call in auth.calls if call[:2] == ('PUT', '/users/anna-id'))
        self.assertEqual(anna[2]['user_metadata'], {'full_name': 'Anna Rossi'})

    def test_required_persona_failure_is_fatal(self):
        auth = FakeAuth({}, reject={'giulia.neri@humans.tech'})
        with self.assertRaises(RuntimeError):
            self.stack().dev_users(auth=auth)

    def test_refuses_remote_stack_before_any_change(self):
        self.env_file.write_text(self.env_file.read_text().replace('http://localhost:8080', 'https://gym.humans.tech'))
        auth = FakeAuth({})
        with self.assertRaisesRegex(ValueError, 'localhost'):
            self.stack().dev_users(auth=auth)
        self.assertEqual(auth.calls, [])
        self.assertEqual(self.log, [])


if __name__ == '__main__':
    unittest.main()
