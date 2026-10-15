#!/usr/bin/env python3
"""Generate a fresh installation's secrets without printing them or overwriting files."""
import argparse
import base64
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import time
import json
import sys
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stack import read_env  # noqa: E402


def generate(local=False):
    jwt_secret = secrets.token_hex(32)

    def token(role):
        def encode(value):
            return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=').decode()
        now = int(time.time())
        payload = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({
            'role': role, 'iss': 'supabase', 'iat': now, 'exp': now + 10 * 365 * 86400,
        })
        signature = base64.urlsafe_b64encode(hmac.new(jwt_secret.encode(), payload.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
        return payload + '.' + signature

    values = {
        'APP_DOMAIN': 'localhost' if local else 'gym.humans.tech',
        'SITE_URL': 'http://localhost:8080' if local else 'https://gym.humans.tech',
        'SUPABASE_PUBLIC_URL': 'http://localhost:8080' if local else 'https://gym.humans.tech',
        'ADDITIONAL_REDIRECT_URLS': 'http://localhost:8080/auth/callback,http://localhost:5173/auth/callback' if local else 'https://gym.humans.tech/auth/callback',
        'ADMIN_EMAIL': 'marco.ciotoli@humans.tech',
        'POSTGRES_PASSWORD': secrets.token_hex(32),
        'JWT_SECRET': jwt_secret,
        'ANON_KEY': token('anon'),
        'SERVICE_ROLE_KEY': token('service_role'),
        'SECRET_KEY_BASE': secrets.token_hex(64),
        'REALTIME_DB_ENC_KEY': secrets.token_hex(8),
        'GOOGLE_ENABLED': 'false' if local else 'true',
        'GOOGLE_CLIENT_ID': '',
        'GOOGLE_CLIENT_SECRET': '',
        'SMTP_HOST': 'mailpit' if local else 'smtp.resend.com',
        'SMTP_PORT': '1025' if local else '587',
        'SMTP_USER': '' if local else 'resend',
        'SMTP_PASS': '',
        'SMTP_FROM': 'gym@services.humans.tech',
        'GYM_PORT': '8080' if local else '18200',
        'BACKUP_BEFORE_DEPLOY': 'false',
        'BACKUP_S3_URI': '',
        'AWS_REGION': '',
        'GITHUB_REPOSITORY': 'humanstech/humans-gym-scheduelr',
        'GITHUB_TOKEN': '',
    }
    if local:
        # Shared password of the local quick-login personas (scripts/stack.py dev-users).
        values['DEV_LOGIN_PASSWORD'] = secrets.token_urlsafe(24)
    return values


# Independent of every other secret, so safe to add to an existing file.
APPENDABLE = ('ADDITIONAL_REDIRECT_URLS', 'DEV_LOGIN_PASSWORD')


def add_missing(path, local=True):
    """Append missing independent keys without touching existing values."""
    current = read_env(path)
    host = urlparse(current.get('SUPABASE_PUBLIC_URL', '')).hostname
    if not local or host not in ('localhost', '127.0.0.1'):
        raise SystemExit('Only a localhost environment file can be updated in place')
    fresh = generate(local=True)
    added = [key for key in APPENDABLE if key not in current]
    if added:
        text = Path(path).read_text()
        with Path(path).open('a') as file:
            if text and not text.endswith('\n'):
                file.write('\n')
            for key in added:
                file.write(f'{key}={fresh[key]}\n')
    return added


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local', action='store_true')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--add-missing', action='store_true',
                        help=f'Existing local file: append only missing {", ".join(APPENDABLE)}')
    args = parser.parse_args()
    if args.add_missing:
        added = add_missing(args.output, args.local)
        print(f'Added to {args.output}: {", ".join(added)}' if added else f'{args.output} is up to date')
        raise SystemExit(0)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as file:
        for key, value in generate(args.local).items():
            file.write(f'{key}={value}\n')
    print(f'Environment generated: {args.output}. Complete OAuth and SMTP configuration before production.')
