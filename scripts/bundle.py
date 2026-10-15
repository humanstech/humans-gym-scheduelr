#!/usr/bin/env python3
"""Build an ARM64 bundle outside production. Only main is eligible for deployment."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

from stack import read_env, run

SERVICES = {'web', 'db', 'auth', 'rest', 'realtime', 'gateway'}


def digest(path):
    checksum = hashlib.sha256()
    with Path(path).open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            checksum.update(block)
    return checksum.hexdigest()


def inspect_image(tag):
    return json.loads(run(['docker', 'image', 'inspect', tag], capture_output=True, text=True).stdout)[0]


def verify_bundle(path, sha, source_hash, public_url, anon_key, expected_branch='main'):
    path = Path(path)
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('Invalid release SHA')
    manifest = json.loads((path / 'bundle.json').read_text())
    if manifest.get('format') != 1 or manifest.get('sha') != sha or manifest.get('branch') != expected_branch:
        raise ValueError('Bundle must belong to the verified main SHA')
    if manifest.get('platform') != 'linux/arm64':
        raise ValueError('Bundle must be ARM64')
    if manifest.get('public_url') != public_url or manifest.get('anon_key_sha256') != hashlib.sha256(anon_key.encode()).hexdigest():
        raise ValueError('Bundle public configuration does not match this installation')
    if set(manifest.get('files', {})) != {'source.tar', 'images.tar.gz'}:
        raise ValueError('Invalid bundle contents')
    for filename, checksum in manifest['files'].items():
        file = path / filename
        if file.is_symlink() or not file.is_file() or digest(file) != checksum:
            raise ValueError(f'Bundle checksum failed: {filename}')
    if manifest['files']['source.tar'] != source_hash:
        raise ValueError('Bundle source differs from main')
    if set(manifest.get('images', {})) != SERVICES:
        raise ValueError('Bundle must contain exactly the Gym runtime images')
    for service, info in manifest['images'].items():
        if info.get('tag') != f'gym-{service}:{sha}' or not re.fullmatch(r'sha256:[a-f0-9]{64}', info.get('id', '')):
            raise ValueError('Invalid Gym image identity')
        if not isinstance(info.get('size'), int) or info['size'] <= 0:
            raise ValueError('Invalid image size')
    # Reject archives that would introduce tags outside this project's namespace.
    with tarfile.open(path / 'images.tar.gz', 'r:gz') as archive:
        entries = json.load(archive.extractfile('manifest.json'))
        actual_tags = {tag for entry in entries for tag in entry.get('RepoTags', [])}
        if actual_tags != {info['tag'] for info in manifest['images'].values()}:
            raise ValueError('Archive contains unexpected image tags')
        configs = {entry['Config']: entry for entry in entries}
        for config, entry in configs.items():
            member = archive.extractfile(config)
            config_bytes = member.read()
            data = json.loads(config_bytes)
            if data.get('architecture') != 'arm64' or data.get('os') != 'linux':
                raise ValueError('Non-ARM64 image in archive')
            for tag in entry['RepoTags']:
                expected = next(info['id'] for info in manifest['images'].values() if info['tag'] == tag)
                if 'sha256:' + hashlib.sha256(config_bytes).hexdigest() != expected:
                    raise ValueError('Image configuration digest mismatch')
    return manifest


def build(args):
    repo = Path(__file__).resolve().parents[1]
    def git(*values):
        return run(['git', '-C', repo, *values], text=True, capture_output=True).stdout.strip()
    if args.development:
        sha = git('rev-parse', 'HEAD')
    else:
        git('fetch', 'origin', 'main')
        sha = git('rev-parse', 'origin/main')
    tracked = git('ls-tree', '-r', '--name-only', sha).splitlines()
    for name in tracked:
        path = Path(name)
        if path.suffix in ('.pem', '.key', '.dump') or (path.name.startswith('.env') and not path.name.endswith('.example')):
            raise ValueError('Refusing to bundle a tracked credential/data file: ' + name)
    public = read_env(args.env_file)
    url, key = public['SUPABASE_PUBLIC_URL'], public['ANON_KEY']
    if not url.startswith(('https://', 'http://localhost:')) or not key or key.startswith('sb_secret_'):
        raise ValueError('Invalid public build configuration')
    if key.count('.') == 2:
        import base64
        payload = json.loads(base64.urlsafe_b64decode(key.split('.')[1] + '==='))
        if payload.get('role') != 'anon':
            raise ValueError('Only the public anon key may be embedded')
    output = Path(args.output).resolve() / sha
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError(f'Bundle already exists: {output}')
    with tempfile.TemporaryDirectory(dir=output.parent, prefix='.gym-build-') as temp:
        temporary = Path(temp)
        bundle = temporary / 'bundle'
        bundle.mkdir()
        run(['git', '-C', repo, 'archive', '--format=tar', '-o', bundle / 'source.tar', sha])
        checkout = temporary / 'source'
        checkout.mkdir()
        with tarfile.open(bundle / 'source.tar') as archive:
            archive.extractall(checkout, filter='data')
        images = json.loads((checkout / 'deploy/images.json').read_text())
        for service, image in images.items():
            run(['docker', 'pull', '--platform', 'linux/arm64', image])
            run(['docker', 'tag', image, f'gym-{service}:{sha}'])
        web = f'gym-web:{sha}'
        run(['docker', 'buildx', 'build', '--platform', 'linux/arm64', '--load',
             '--label', f'org.opencontainers.image.revision={sha}',
             '--build-arg', f'VITE_SUPABASE_URL={url}', '--build-arg', f'VITE_SUPABASE_ANON_KEY={key}',
             '--build-arg', f'RELEASE_SHA={sha}', '-t', web, checkout])
        manifest = {'format': 1, 'sha': sha, 'branch': 'development' if args.development else 'main',
                    'platform': 'linux/arm64', 'public_url': url,
                    'anon_key_sha256': hashlib.sha256(key.encode()).hexdigest(), 'images': {}}
        tags = []
        for service in sorted(SERVICES):
            tag = f'gym-{service}:{sha}'
            info = inspect_image(tag)
            if (info['Os'], info['Architecture']) != ('linux', 'arm64'):
                raise ValueError(f'Wrong platform: {tag}')
            manifest['images'][service] = {'tag': tag, 'id': info['Id'], 'size': info['Size']}
            tags.append(tag)
        # Stream compression: no second uncompressed copy on disk.
        with (bundle / 'images.tar.gz').open('wb') as file:
            save = subprocess.Popen(['docker', 'image', 'save', *tags], stdout=subprocess.PIPE)
            try:
                run(['gzip', '-1'], stdin=save.stdout, stdout=file)
            finally:
                save.stdout.close()
            if save.wait() != 0:
                raise RuntimeError('docker save failed')
        manifest['files'] = {name: digest(bundle / name) for name in ['source.tar', 'images.tar.gz']}
        (bundle / 'bundle.json').write_text(json.dumps(manifest, indent=2) + '\n')
        verify_bundle(bundle, sha, manifest['files']['source.tar'], url, key, expected_branch=manifest['branch'])
        bundle.rename(output)
    print(f'Bundle ready: {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env.production.local', help='Only the public URL and anon key are passed to the build')
    parser.add_argument('--output', required=True)
    parser.add_argument('--development', action='store_true', help='Local verification only; production rejects these bundles')
    build(parser.parse_args())
