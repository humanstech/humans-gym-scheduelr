#!/usr/bin/env python3
"""Transfer a complete main bundle to Gym's root-only incoming directory."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tarfile
import uuid

from stack import read_env, run
from bundle import digest, verify_bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--ssh-key', required=True, type=Path)
    parser.add_argument('--env-file', default='.env.production.local')
    args = parser.parse_args()
    env = read_env(args.env_file)
    sha = json.loads((args.bundle / 'bundle.json').read_text())['sha']
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('Invalid SHA')
    verify_bundle(args.bundle, sha, digest(args.bundle / 'source.tar'),
                  env['SUPABASE_PUBLIC_URL'], env['ANON_KEY'])
    ssh = ['ssh', '-i', str(args.ssh_key), '-o', 'ConnectTimeout=15', 'ubuntu@63.178.93.191']
    stage = f'/opt/gym/incoming/.upload-{sha}-{uuid.uuid4().hex}'
    destination = f'/opt/gym/incoming/{sha}'
    run(ssh + [f'sudo install -d -o root -g root -m 700 {stage}'])
    try:
        receiver = subprocess.Popen(ssh + [f'sudo sh -c "umask 077; tar -xf - -C {stage} --no-same-owner --no-same-permissions"'], stdin=subprocess.PIPE)
        try:
            with tarfile.open(fileobj=receiver.stdin, mode='w|') as archive:
                for name in ['bundle.json', 'source.tar', 'images.tar.gz']:
                    archive.add(args.bundle / name, arcname=name, recursive=False)
        finally:
            receiver.stdin.close()
            result = receiver.wait()
        if result != 0:
            raise RuntimeError('Transfer failed')
        # Root-only rename publishes the bundle atomically; never replace a release.
        run(ssh + [f"sudo flock /opt/gym/deploy.lock sh -c 'test ! -e {destination} && mv -T {stage} {destination}'"])
    except BaseException:
        run(ssh + [f'sudo rm -rf -- {stage}'])
        raise
    print(f'Bundle transferred: {sha}. The server independently verifies main and CI before deployment.')


if __name__ == '__main__':
    main()
