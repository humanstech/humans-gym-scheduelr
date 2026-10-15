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
    parser.add_argument('action', choices=['migrate', 'seed', 'backup', 'compose'])
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--project', default='gym')
    parser.add_argument('--sha', default='local')
    parser.add_argument('--release', default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--backup-dir', default='/opt/gym/backups')
    args, extra = parser.parse_known_args()
    stack = Stack(args.release, args.env_file, args.project, args.sha)
    try:
        if args.action == 'compose': stack.compose(*(extra[1:] if extra[:1] == ['--'] else extra))
        elif args.action == 'migrate': stack.migrate()
        elif args.action == 'seed': stack.seed()
        elif args.action == 'backup': print(stack.backup(args.backup_dir))
    except subprocess.CalledProcessError as error:
        # psql errors are useful; never print subprocess argument lists with secrets.
        if error.stderr: print(error.stderr)
        raise SystemExit(f'{args.action} failed (exit {error.returncode})') from None
