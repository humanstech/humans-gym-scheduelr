#!/usr/bin/env python3
"""Shared Compose and migration operations; secrets stay outside release directories."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.parse import urlparse
import urllib.request

LOCAL_HOSTS = ('localhost', '127.0.0.1')
# Local quick-login personas; keep in sync with src/components/DevLogin.tsx (checked by scripts/tests).
# None stands for ADMIN_EMAIL. Optional personas may be rejected until the PT schema exists.
DEV_PERSONAS = [
    {'email': None, 'name': 'Marco Ciotoli'},
    {'email': 'anna.rossi@humans.tech', 'name': 'Anna Rossi'},
    {'email': 'luca.bianchi@humans.tech', 'name': 'Luca Bianchi'},
    {'email': 'sara.verdi@humans.tech', 'name': 'Sara Verdi'},
    {'email': 'giulia.neri@humans.tech', 'name': 'Giulia Neri'},
    {'email': 'trainer.pt@example.com', 'name': 'Paolo Trainer', 'optional': True},
]


def read_env(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, value = line.split('=', 1)
        parts = shlex.split(value, comments=True)
        if len(parts) > 1:
            raise ValueError(f'Quote the value for {key}')
        result[key.strip()] = parts[0] if parts else ''
    return result


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def require_local(env):
    """Dev conveniences (shared passwords, personas) never target a real installation."""
    for key in ('SUPABASE_PUBLIC_URL', 'SITE_URL'):
        if urlparse(env.get(key, '')).hostname not in LOCAL_HOSTS:
            raise ValueError(f'{key} must point to localhost: refusing to run on a non-local stack')


def write_dev_env(env, path):
    """Write .env.local for `npm run dev`, keeping unrelated lines. Only public values plus the local password."""
    require_local(env)
    values = {
        'VITE_SUPABASE_URL': env['SUPABASE_PUBLIC_URL'],
        'VITE_SUPABASE_ANON_KEY': env['ANON_KEY'],
        'VITE_DEV_LOGIN': 'true',
        'VITE_DEV_LOGIN_PASSWORD': env['DEV_LOGIN_PASSWORD'],
    }
    path = Path(path)
    lines = path.read_text().splitlines() if path.exists() else []
    kept = [line for line in lines if line.split('=', 1)[0].strip() not in values]
    fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write(''.join(line + '\n' for line in kept) + ''.join(f'{k}={v}\n' for k, v in values.items()))
    os.chmod(path, 0o600)


class AuthAdmin:
    """Minimal GoTrue admin client; never echoes request headers."""
    def __init__(self, url, service_key):
        self.url = url.rstrip('/') + '/auth/v1/admin'
        self.headers = {'apikey': service_key, 'Authorization': f'Bearer {service_key}',
                        'Content-Type': 'application/json'}

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.url + path, data=data, headers=self.headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read() or b'{}')
        except HTTPError as error:
            try:
                detail = json.loads(error.read())
                message = detail.get('msg') or detail.get('message') or detail.get('error_description') or str(detail)
            except ValueError:
                message = error.reason
            raise RuntimeError(f'{method} /admin{path.split("?")[0]}: HTTP {error.code} {message}') from None

    def users(self):
        result, page = {}, 1
        while True:
            users = self.request('GET', f'/users?page={page}&per_page=200').get('users', [])
            result.update({user['email'].lower(): user['id'] for user in users if user.get('email')})
            if len(users) < 200:
                return result
            page += 1


class Stack:
    def __init__(self, release, env_file, project='gym', sha='local'):
        self.release = Path(release).resolve()
        self.env_file = Path(env_file).resolve()
        self.env = read_env(self.env_file)
        self.process_env = dict(os.environ, RELEASE_SHA=sha, COMPOSE_PROJECT_NAME=project)
        image_file = self.release / '.gym-images.json'
        if image_file.is_file():
            for service, info in json.loads(image_file.read_text()).items():
                self.process_env[service.upper() + '_IMAGE'] = info['tag']
        self.command = ['docker', 'compose', '--project-name', project, '--env-file', str(self.env_file),
                        '-f', str(self.release / 'deploy/compose.yml')]

    def compose(self, *args, **kwargs):
        return run(self.command + list(args), env=self.process_env, **kwargs)

    def sql(self, sql, *args):
        return self.compose('exec', '-T', 'db', 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
                            '-v', 'ON_ERROR_STOP=1', *args, input=sql, text=True, capture_output=True).stdout

    def migrate(self):
        # One transaction and advisory lock for the entire pending migration batch.
        # Checksums prevent silently editing migrations already applied in production.
        sql = """BEGIN;
SELECT pg_advisory_xact_lock(715021014);
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS private.schema_migrations (
  version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
"""
        for path in sorted((self.release / 'supabase/migrations').glob('*.sql')):
            if not re.fullmatch(r'[0-9]+_[a-z0-9_]+', path.stem):
                raise ValueError('Invalid migration filename')
            content = path.read_text()
            checksum = hashlib.sha256(content.encode()).hexdigest()
            version = path.stem
            sql += rf"""
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM private.schema_migrations WHERE version = '{version}' AND checksum <> '{checksum}') THEN
    RAISE EXCEPTION 'Applied migration changed: {version}';
  END IF;
END $$;
SELECT NOT EXISTS (SELECT 1 FROM private.schema_migrations WHERE version = '{version}') AS apply_migration \gset
\if :apply_migration
{content}
INSERT INTO private.schema_migrations(version, checksum) VALUES ('{version}', '{checksum}');
\endif
"""
        self.sql(sql + "\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n")

    def seed(self):
        email = self.env.get('ADMIN_EMAIL', '')
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('ADMIN_EMAIL must be a valid email address')
        self.sql((self.release / 'supabase/seed.sql').read_text(), '-v', f'admin_email={email}')

    def dev_sql(self, path, admin_email):
        """Run one supabase/dev script atomically; failures are reported, not fatal."""
        try:
            self.sql(path.read_text(), '--single-transaction', '-v', f'admin_email={admin_email}')
            print(f'  ok    {path.name}')
            return True
        except subprocess.CalledProcessError as error:
            reason = (error.stderr or '').strip().splitlines()
            print(f'  WARN  {path.name} not applied: {reason[0] if reason else "psql failed"}')
            return False

    def dev_users(self, auth=None):
        """Idempotently create the local personas with DEV_LOGIN_PASSWORD, then load supabase/dev data."""
        require_local(self.env)
        admin_email = self.env.get('ADMIN_EMAIL', '').lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', admin_email):
            raise ValueError('ADMIN_EMAIL must be a valid email address')
        password = self.env.get('DEV_LOGIN_PASSWORD', '')
        if len(password) < 16:
            raise ValueError('DEV_LOGIN_PASSWORD missing: run scripts/local.sh up (or make-env.py --local --add-missing)')
        directory = self.release / 'supabase/dev'
        scripts = sorted(directory.glob('*.sql')) if directory.is_dir() else []
        for path in scripts:
            if not re.fullmatch(r'[0-9]+_[a-z0-9_]+', path.stem):
                raise ValueError(f'Invalid dev script filename: {path.name}')
        # 00_* grants access (e.g. the trainer row) that the auth.users trigger checks on signup.
        early = [path for path in scripts if path.name.startswith('00_')]
        late = [path for path in scripts if path not in early]
        if not scripts:
            print('  info  no supabase/dev/*.sql scripts found')
        for path in early:
            self.dev_sql(path, admin_email)
        auth = auth or AuthAdmin(self.env['SUPABASE_PUBLIC_URL'], self.env['SERVICE_ROLE_KEY'])
        existing = auth.users()
        created = []
        for persona in DEV_PERSONAS:
            email = persona['email'] or admin_email
            try:
                if email in existing:
                    body = {'password': password, 'email_confirm': True}
                    if persona['email']:  # leave the real admin's profile metadata alone
                        body['user_metadata'] = {'full_name': persona['name']}
                    auth.request('PUT', f'/users/{existing[email]}', body)
                    print(f'  ok    {email} (password updated)')
                else:
                    auth.request('POST', '/users', {'email': email, 'password': password, 'email_confirm': True,
                                                    'user_metadata': {'full_name': persona['name']}})
                    print(f'  ok    {email} (created)')
                created.append(email)
            except RuntimeError as error:
                if not persona.get('optional'):
                    raise
                print(f'  WARN  {email} skipped ({error}); expected until the PT schema and dev scripts exist')
        for path in late:
            self.dev_sql(path, admin_email)
        return created

    def backup(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Include auth + private migrations + public + cron metadata. Full DB backup.
        with tempfile.NamedTemporaryFile(dir=directory, prefix='backup-', suffix='.dump', delete=False) as file:
            path = Path(file.name)
            try:
                self.compose('exec', '-T', 'db', 'pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc', stdout=file)
            except BaseException:
                path.unlink(missing_ok=True)
                raise
        # Validate archive before considering it a backup.
        with path.open('rb') as file:
            self.compose('exec', '-T', 'db', 'pg_restore', '--list', stdin=file, stdout=subprocess.DEVNULL)
        uri = self.env.get('BACKUP_S3_URI')
        if uri:
            run(['aws', 's3', 'cp', path, uri.rstrip('/') + '/' + path.name, '--sse', 'AES256',
                 '--region', self.env['AWS_REGION'], '--only-show-errors'])
        return path


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['migrate', 'seed', 'backup', 'compose', 'dev-users', 'dev-env'])
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--project', default='gym')
    parser.add_argument('--sha', default='local')
    parser.add_argument('--release', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--backup-dir', default='/opt/gym/backups')
    parser.add_argument('--output', default='.env.local', help='dev-env: Vite env file to write')
    args, extra = parser.parse_known_args()
    if args.action == 'dev-env':
        try:
            write_dev_env(read_env(args.env_file), args.output)
        except (ValueError, KeyError) as error:
            raise SystemExit(f'dev-env failed: {error}') from None
        print(f'Written {args.output} (gitignored): npm run dev -> http://localhost:5173')
        raise SystemExit(0)
    stack = Stack(args.release, args.env_file, args.project, args.sha)
    try:
        if args.action == 'compose': stack.compose(*(extra[1:] if extra[:1] == ['--'] else extra))
        elif args.action == 'migrate': stack.migrate()
        elif args.action == 'seed': stack.seed()
        elif args.action == 'backup': print(stack.backup(args.backup_dir))
        elif args.action == 'dev-users':
            print(f'Local personas ready: {len(stack.dev_users())}/{len(DEV_PERSONAS)} (password: DEV_LOGIN_PASSWORD)')
    except (ValueError, RuntimeError) as error:
        raise SystemExit(f'{args.action} failed: {error}') from None
    except subprocess.CalledProcessError as error:
        # psql errors are useful; never print subprocess argument lists with secrets.
        if error.stderr: print(error.stderr)
        raise SystemExit(f'{args.action} failed (exit {error.returncode})') from None
