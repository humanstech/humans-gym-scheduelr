import importlib.util
from pathlib import Path
import sys
import unittest
import json
import tempfile
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from production import Production, ci_passed, validate_production

spec = importlib.util.spec_from_file_location('make_env', Path(__file__).resolve().parents[1] / 'make-env.py')
make_env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_env)


class DeploymentPolicyTests(unittest.TestCase):
    def run_data(self, **changes):
        return dict(head_sha='abc', head_branch='main', event='push', path='.github/workflows/ci.yml',
                    head_repository={'full_name': 'humanstech/humans-gym-scheduelr'},
                    run_number=1, run_attempt=1, status='completed', conclusion='success', **changes)

    def passed(self, runs):
        return ci_passed({'workflow_runs': runs}, 'abc', 'humanstech/humans-gym-scheduelr')

    def test_only_exact_main_workflow_is_eligible(self):
        self.assertTrue(self.passed([self.run_data()]))
        for key, value in [('head_sha', 'older'), ('head_branch', 'develop'), ('event', 'pull_request'),
                           ('path', '.github/workflows/other.yml'), ('conclusion', 'failure'),
                           ('status', 'in_progress'), ('head_repository', {'full_name': 'fork/project'})]:
            data = self.run_data()
            data[key] = value
            self.assertFalse(self.passed([data]), key)
        self.assertFalse(self.passed([]))

    def test_latest_attempt_must_pass(self):
        old = self.run_data()
        new = dict(old, run_attempt=2, conclusion='failure')
        self.assertFalse(self.passed([old, new]))
        self.assertFalse(self.passed([new, old]))

    def test_generated_environment_needs_explicit_production_configuration(self):
        with self.assertRaises(ValueError):
            validate_production(make_env.generate())

    def test_email_only_launch_does_not_require_google_credentials(self):
        env = make_env.generate()
        env.update(GOOGLE_ENABLED='false', SMTP_PASS='smtp-test')
        validate_production(env)

    def test_enabling_google_requires_both_credentials(self):
        env = make_env.generate()
        env.update(SMTP_PASS='smtp-test')
        with self.assertRaisesRegex(ValueError, 'GOOGLE_CLIENT_ID'):
            validate_production(env)

    def test_each_installation_gets_different_secrets(self):
        a, b = make_env.generate(), make_env.generate()
        for key in ['POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'REALTIME_DB_ENC_KEY']:
            self.assertNotEqual(a[key], b[key])


class DeploymentFailureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        env = make_env.generate()
        env.update(SMTP_HOST='smtp.test', SMTP_USER='user', SMTP_PASS='pass',
                   GOOGLE_CLIENT_ID='client', GOOGLE_CLIENT_SECRET='secret', BACKUP_BEFORE_DEPLOY='false')
        path = self.root / 'production.env'
        path.write_text('\n'.join(f'{k}={v}' for k, v in env.items()))
        self.production = Production(self.root, path)
        self.previous = {'sha': 'b' * 40}
        self.production.state.write_text(json.dumps(self.previous))
        self.sha = 'a' * 40
        self.release = self.root / 'releases' / self.sha
        (self.release / 'scripts').mkdir(parents=True)
        for name in ['production.py', 'stack.py', 'bundle.py']:
            (self.release / 'scripts' / name).write_text('# fixture\n')
        self.production.main_sha = MagicMock(return_value=self.sha)
        self.production.approved = MagicMock(return_value=True)
        self.production.prepare_bundle = MagicMock(return_value=(self.root / 'bundle', {}))
        self.production.load_bundle = MagicMock(return_value=self.release)
        self.production.preflight = MagicMock()
        self.production.health = MagicMock()

    @patch('production.Stack')
    def test_pending_ci_does_not_touch_stack(self, stack):
        self.production.approved.return_value = False
        self.production.deploy()
        stack.assert_not_called()

    @patch('production.Stack')
    def test_missing_bundle_does_not_touch_stack(self, stack):
        self.production.prepare_bundle.return_value = None
        self.production.deploy()
        stack.assert_not_called()
        self.production.load_bundle.assert_not_called()

    @patch('production.Stack')
    def test_invalid_bundle_does_not_touch_stack(self, stack):
        self.production.prepare_bundle.side_effect = ValueError('checksum mismatch')
        with self.assertRaises(ValueError):
            self.production.deploy()
        stack.assert_not_called()
        self.production.load_bundle.assert_not_called()

    @patch('production.Stack')
    def test_backup_failure_prevents_migrations(self, stack):
        self.production.env['BACKUP_BEFORE_DEPLOY'] = 'true'
        stack.return_value.backup.side_effect = RuntimeError('Backup unavailable')
        with self.assertRaises(RuntimeError):
            self.production.deploy()
        stack.return_value.migrate.assert_not_called()
        self.assertEqual(json.loads(self.production.state.read_text()), self.previous)
        stack.reset_mock()
        self.production.deploy()  # does not endlessly retry a failed SHA
        stack.assert_not_called()

    @patch('production.Stack')
    def test_main_advance_during_import_skips_release(self, stack):
        self.production.main_sha.side_effect = [self.sha, 'c' * 40]
        self.production.deploy()
        stack.return_value.backup.assert_not_called()
        self.assertFalse(self.production.failed.exists())

    @patch('production.Stack')
    def test_failed_health_restores_previous_release(self, factory):
        new, old = MagicMock(), MagicMock()
        factory.side_effect = [new, old]
        self.production.health.side_effect = [RuntimeError('HTTP unhealthy'), None]
        with self.assertRaises(RuntimeError):
            self.production.deploy()
        old.compose.assert_called_once_with('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300')
        self.assertEqual(json.loads(self.production.state.read_text()), self.previous)

    @patch('production.Stack')
    def test_success_records_verified_sha_without_reseeding(self, stack):
        self.production.deploy()
        self.assertEqual(json.loads(self.production.state.read_text())['sha'], self.sha)
        stack.return_value.seed.assert_not_called()
        stack.return_value.backup.assert_not_called()
        self.assertFalse(self.production.failed.exists())


if __name__ == '__main__':
    unittest.main()
