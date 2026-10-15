#!/usr/bin/env python3
"""Deploy only the current main commit after GitHub CI has passed."""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

from stack import Stack, read_env, run


def ci_passed(response, sha, repository):
    runs = [r for r in response.get('workflow_runs', []) if
            r.get('head_sha') == sha and r.get('head_branch') == 'main' and
            r.get('event') in ('push', 'workflow_dispatch') and
            r.get('path') == '.github/workflows/ci.yml' and
            r.get('head_repository', {}).get('full_name', '').lower() == repository.lower()]
    if not runs:
        return False
    latest = max(runs, key=lambda r: (r['run_number'], r.get('run_attempt', 1)))
    return latest.get('status') == 'completed' and latest.get('conclusion') == 'success'


def request_json(url, token=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'gym-deployer'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as response:
        return json.load(response)


def validate_production(env):
    required = ['ADMIN_EMAIL', 'POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY',
                'REALTIME_DB_ENC_KEY', 'SECRET_KEY_BASE', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
                'SMTP_FROM', 'BACKUP_S3_URI', 'AWS_REGION', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
    missing = [key for key in required if not env.get(key)]
    if missing:
        raise ValueError('Complete production settings: ' + ', '.join(missing))
    for domain, url in [('APP_DOMAIN', 'SITE_URL'), ('API_DOMAIN', 'SUPABASE_PUBLIC_URL')]:
        if not re.fullmatch(r'[a-zA-Z0-9.-]+', env.get(domain, '')) or env.get(url) != 'https://' + env[domain]:
            raise ValueError(f'{domain} must match the HTTPS {url}')
    if env.get('GOOGLE_ENABLED') != 'true':
        raise ValueError('Enable Google OAuth before production')
    if not env['BACKUP_S3_URI'].startswith('s3://'):
        raise ValueError('BACKUP_S3_URI must be an S3 prefix')
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+', env.get('GITHUB_REPOSITORY', '')):
        raise ValueError('Invalid GITHUB_REPOSITORY')


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


class Production:
    def __init__(self, root, env_file):
        self.root = Path(root).resolve()
        self.env_file = Path(env_file).resolve()
        self.env = read_env(self.env_file)
        self.repo = self.root / 'repo.git'
        self.state = self.root / 'deployed.json'
        self.failed = self.root / 'failed.json'

    def git(self, *args):
        return run(['git', '--git-dir', self.repo, *args], text=True, capture_output=True).stdout.strip()

    def main_sha(self):
        if not self.repo.exists():
            run(['git', 'init', '--bare', self.repo], stdout=subprocess.DEVNULL)
            self.git('remote', 'add', 'origin', f'https://github.com/{self.env["GITHUB_REPOSITORY"]}.git')
        # Deliberately never fetch develop or accept a user-selected release SHA.
        self.git('fetch', '--quiet', '--depth=20', 'origin', '+refs/heads/main:refs/remotes/origin/main')
        return self.git('rev-parse', 'refs/remotes/origin/main')

    def approved(self, sha):
        repository = self.env['GITHUB_REPOSITORY']
        query = urllib.parse.urlencode({'branch': 'main', 'head_sha': sha, 'per_page': 20})
        url = f'https://api.github.com/repos/{repository}/actions/workflows/ci.yml/runs?{query}'
        return ci_passed(request_json(url, self.env.get('GITHUB_TOKEN')), sha, repository)

    def extract(self, sha):
        if not re.fullmatch('[a-f0-9]{40}', sha):
            raise ValueError('Invalid commit SHA')
        release = self.root / 'releases' / sha
        if not release.exists():
            release.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=release.parent) as temporary:
                temporary = Path(temporary)
                archive = temporary / 'release.tar'
                self.git('archive', '--format=tar', '-o', str(archive), sha)
                checkout = temporary / 'checkout'
                checkout.mkdir()
                with tarfile.open(archive) as tar:
                    # Python 3.12 Ubuntu: reject escaping paths/links and device files.
                    tar.extractall(checkout, filter='data')
                checkout.rename(release)
        return release

    def health(self, sha):
        for attempt in range(12):
            try:
                version = request_json(self.env['SITE_URL'] + '/version.json')
                if version.get('sha') != sha:
                    raise ValueError('Public frontend serves a different SHA')
                key_headers = {'apikey': self.env['ANON_KEY']}
                for path in ['/auth/v1/health', '/rest/v1/']:
                    request = urllib.request.Request(self.env['SUPABASE_PUBLIC_URL'] + path, headers=key_headers)
                    with urllib.request.urlopen(request, timeout=10) as response:
                        if response.status != 200:
                            raise ValueError('API health failed')
                return
            except Exception:
                if attempt == 11:
                    raise
                time.sleep(5)

    def deploy(self, bootstrap=False, retry=False):
        validate_production(self.env)
        previous = json.loads(self.state.read_text()) if self.state.exists() else None
        if previous is None and not bootstrap:
            raise ValueError('Run bootstrap once before enabling the deploy timer')
        if previous and bootstrap:
            raise ValueError('Already initialized; use poll for subsequent releases')
        sha = self.main_sha()
        if previous and previous['sha'] == sha:
            return
        if self.failed.exists() and json.loads(self.failed.read_text())['sha'] == sha and not retry:
            print(f'Commit {sha} previously failed; fix main or run retry after resolving the cause')
            return
        if not self.approved(sha):
            print(f'Waiting for successful main CI: {sha}')
            return
        release = self.extract(sha)
        stack = Stack(release, self.env_file, sha=sha)
        # Mark pending first: a timeout or killed process also needs an explicit retry.
        atomic_json(self.failed, {'sha': sha, 'started_at': int(time.time())})
        # Build while the current release is serving traffic. No secrets in the image.
        stack.compose('build', 'web')
        if self.main_sha() != sha:
            self.failed.unlink(missing_ok=True)
            print('main advanced during build; next timer run will deploy the new commit')
            return
        stack.compose('up', '-d', '--wait', '--wait-timeout', '180', 'db')
        backup = stack.backup(self.root / 'backups') if previous else None
        stack.migrate()
        if bootstrap:
            stack.seed()
        try:
            stack.compose('up', '-d', '--wait', '--wait-timeout', '300')
            self.health(sha)
        except Exception:
            if previous:
                print('Health check failed; restoring the previous application release. Database migrations remain applied.')
                old = Stack(self.root / 'releases' / previous['sha'], self.env_file, sha=previous['sha'])
                old.compose('up', '-d', '--wait', '--wait-timeout', '300')
                self.health(previous['sha'])
            raise
        atomic_json(self.state, {'sha': sha, 'previous_sha': previous['sha'] if previous else None,
                                'deployed_at': int(time.time()), 'pre_deploy_backup': str(backup) if backup else None})
        self.failed.unlink(missing_ok=True)
        current = self.root / 'current'
        temporary = self.root / 'current.next'
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(release, target_is_directory=True)
        temporary.replace(current)
        # Update the timer's code only from the verified and healthy main release.
        tools = self.root / 'tools'
        tools.mkdir(exist_ok=True)
        for name in ['production.py', 'stack.py']:
            target = tools / name
            staged = target.with_suffix('.next')
            staged.write_bytes((release / 'scripts' / name).read_bytes())
            staged.replace(target)
        print(f'Deployed main {sha}')

    def backup(self):
        state = json.loads(self.state.read_text())
        stack = Stack(self.root / 'releases' / state['sha'], self.env_file, sha=state['sha'])
        path = stack.backup(self.root / 'backups')
        print(f'Backup complete: {path.name}')
        # S3 retention is independently controlled by the bucket lifecycle.
        for old in (self.root / 'backups').glob('*.dump'):
            if old.stat().st_mtime < time.time() - 7 * 86400:
                old.unlink()


@contextlib.contextmanager
def exclusive_lock(path):
    with path.open('a') as file:
        fcntl.flock(file, fcntl.LOCK_EX)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['bootstrap', 'poll', 'retry', 'backup', 'status'])
    parser.add_argument('--root', default='/opt/gym')
    parser.add_argument('--env-file', default='/etc/gym/production.env')
    args = parser.parse_args()
    production = Production(args.root, args.env_file)
    production.root.mkdir(parents=True, exist_ok=True)
    with exclusive_lock(production.root / 'operation.lock'):
        if args.action == 'status':
            print(production.state.read_text() if production.state.exists() else 'Not deployed')
        elif args.action == 'backup': production.backup()
        else: production.deploy(bootstrap=args.action == 'bootstrap', retry=args.action in ('bootstrap', 'retry'))


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.stderr: print(error.stderr)
        raise SystemExit(f'Operation failed (exit {error.returncode}); previous deployed state was retained') from None
