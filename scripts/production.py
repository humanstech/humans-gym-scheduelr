#!/usr/bin/env python3
"""Deploy only the current main commit after GitHub CI has passed."""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

from stack import Stack, read_env, run
from bundle import digest, inspect_image, verify_bundle


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
                'SMTP_FROM']
    missing = [key for key in required if not env.get(key)]
    if missing:
        raise ValueError('Complete production settings: ' + ', '.join(missing))
    for domain, url in [('APP_DOMAIN', 'SITE_URL'), ('APP_DOMAIN', 'SUPABASE_PUBLIC_URL')]:
        if not re.fullmatch(r'[a-zA-Z0-9.-]+', env.get(domain, '')) or env.get(url) != 'https://' + env[domain]:
            raise ValueError(f'{domain} must match the HTTPS {url}')
    if env.get('GOOGLE_ENABLED') not in ('true', 'false'):
        raise ValueError('GOOGLE_ENABLED must be true or false')
    if env.get('GOOGLE_ENABLED') == 'true' and not all(env.get(k) for k in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')):
        raise ValueError('Google OAuth enabled: complete GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET')
    if env.get('GYM_PORT') != '18200' or env.get('APP_DOMAIN') != 'gym.humans.tech':
        raise ValueError('This installation is assigned gym.humans.tech on loopback port 18200')
    if env.get('BACKUP_BEFORE_DEPLOY', 'false') not in ('true', 'false'):
        raise ValueError('Invalid BACKUP_BEFORE_DEPLOY')
    if env.get('BACKUP_S3_URI') and (not env['BACKUP_S3_URI'].startswith('s3://') or not env.get('AWS_REGION')):
        raise ValueError('Optional external backup needs an S3 prefix and region')
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

    def prepare_bundle(self, sha):
        bundle = self.root / 'incoming' / sha
        if not (bundle / 'bundle.json').is_file():
            return None
        with tempfile.TemporaryDirectory(dir=self.root) as temporary:
            archive = Path(temporary) / 'source.tar'
            self.git('archive', '--format=tar', '-o', str(archive), sha)
            manifest = verify_bundle(bundle, sha, digest(archive),
                                     self.env['SUPABASE_PUBLIC_URL'], self.env['ANON_KEY'])
        return bundle, manifest

    def load_bundle(self, sha, bundle, manifest):
        # No build, QEMU, package installation or remote registry pulls on this host.
        run(['docker', 'image', 'load', '-i', bundle / 'images.tar.gz'])
        for info in manifest['images'].values():
            actual = inspect_image(info['tag'])
            if actual['Id'] != info['id'] or (actual['Os'], actual['Architecture']) != ('linux', 'arm64'):
                raise ValueError('Loaded image differs from verified ARM64 bundle')
        web = inspect_image(f'gym-web:{sha}')
        if web.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != sha:
            raise ValueError('Frontend image revision mismatch')
        release = self.root / 'releases' / sha
        if not release.exists():
            release.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=release.parent) as temporary:
                checkout = Path(temporary) / 'checkout'
                checkout.mkdir()
                with tarfile.open(bundle / 'source.tar') as archive:
                    archive.extractall(checkout, filter='data')
                (checkout / '.gym-images.json').write_text(json.dumps(manifest['images'], sort_keys=True))
                checkout.rename(release)
        elif json.loads((release / '.gym-images.json').read_text()) != manifest['images']:
            raise ValueError('Refusing to change an existing immutable release')
        return release

    def preflight(self, manifest, previous):
        if os.uname().machine != 'aarch64':
            raise ValueError('Production requires native ARM64; no emulation')
        for path, mode in [(self.root, 0o700), (self.env_file, 0o600)]:
            info = path.stat()
            if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != mode:
                raise ValueError(f'{path} must be root-owned, mode {mode:o}')
        if self.env_file != self.root / '.env':
            raise ValueError('Production secrets belong in /opt/gym/.env')
        # Account for image loading plus Docker storage overhead and a 2 GiB reserve.
        needed = int(sum(info['size'] for info in manifest['images'].values()) * 1.3) + 2 * 1024**3
        docker_root = run(['docker', 'info', '--format', '{{.DockerRootDir}}'], text=True, capture_output=True).stdout.strip()
        for directory in [self.root, Path(docker_root)]:
            if shutil.disk_usage(directory).free < needed:
                raise ValueError(f'Not enough disk space in {directory}; need {needed // 1024**2} MiB free')
        # Explicit registry-port check before first bind. On updates verify its owner.
        listeners = run(['ss', '-H', '-ltn', 'sport = :18200'], text=True, capture_output=True).stdout
        if listeners.strip():
            ids = run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=gym',
                       '--filter', 'label=com.docker.compose.service=web'], text=True, capture_output=True).stdout.split()
            if len(ids) != 1:
                raise ValueError('Port 18200 is already in use by another listener')
            container = json.loads(run(['docker', 'inspect', ids[0]], text=True, capture_output=True).stdout)[0]
            bindings = container['HostConfig']['PortBindings'].get('8080/tcp')
            if bindings != [{'HostIp': '127.0.0.1', 'HostPort': '18200'}]:
                raise ValueError('Unexpected port owner/binding')
        else:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 18200))

    def health(self, sha):
        for attempt in range(12):
            try:
                with urllib.request.urlopen(self.env['SITE_URL'] + '/healthz', timeout=10) as response:
                    if response.read().strip() != b'ok':
                        raise ValueError('Public health failed')
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
        prepared = self.prepare_bundle(sha)
        if prepared is None:
            print(f'Waiting for ARM64 bundle: {sha}')
            return
        bundle, manifest = prepared
        self.preflight(manifest, previous)
        # Mark pending first: a timeout or killed process also needs an explicit retry.
        atomic_json(self.failed, {'sha': sha, 'started_at': int(time.time())})
        release = self.load_bundle(sha, bundle, manifest)
        stack = Stack(release, self.env_file, sha=sha)
        if self.main_sha() != sha:
            self.failed.unlink(missing_ok=True)
            print('main advanced during bundle import; next timer run will deploy the new commit')
            return
        backup = None
        if previous and self.env.get('BACKUP_BEFORE_DEPLOY') == 'true':
            old = Stack(self.root / 'releases' / previous['sha'], self.env_file, sha=previous['sha'])
            backup = old.backup(self.root / 'backups')
        try:
            stack.compose('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'db', 'auth')
            stack.migrate()
            if bootstrap:
                stack.seed()
            stack.compose('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300')
            self.health(sha)
        except Exception:
            if previous:
                print('Health check failed; restoring the previous application release. Database migrations remain applied.')
                old = Stack(self.root / 'releases' / previous['sha'], self.env_file, sha=previous['sha'])
                old.compose('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300')
                self.health(previous['sha'])
            raise
        current = self.root / 'current'
        temporary = self.root / 'current.next'
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(release, target_is_directory=True)
        temporary.replace(current)
        atomic_json(self.state, {'sha': sha, 'previous_sha': previous['sha'] if previous else None,
                                'deployed_at': int(time.time()), 'pre_deploy_backup': str(backup) if backup else None})
        self.failed.unlink(missing_ok=True)
        # Update the timer's code only from the verified and healthy main release.
        tools = self.root / 'tools'
        tools.mkdir(exist_ok=True)
        for name in ['production.py', 'stack.py', 'bundle.py']:
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
    parser.add_argument('--env-file', default='/opt/gym/.env')
    args = parser.parse_args()
    os.umask(0o077)
    production = Production(args.root, args.env_file)
    production.root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with exclusive_lock(production.root / 'deploy.lock'):
        if args.action == 'status':
            print(production.state.read_text() if production.state.exists() else 'Not deployed')
        elif args.action == 'backup': production.backup()
        else: production.deploy(bootstrap=args.action == 'bootstrap', retry=args.action in ('bootstrap', 'retry'))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, FileNotFoundError) as error:
        raise SystemExit(str(error)) from None
    except subprocess.CalledProcessError as error:
        if error.stderr: print(error.stderr)
        raise SystemExit(f'Operation failed (exit {error.returncode}); previous deployed state was retained') from None
