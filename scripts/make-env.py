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

    return {
        'APP_DOMAIN': 'http://localhost:8080' if local else 'gym.humans.tech',
        'API_DOMAIN': 'http://localhost:8000' if local else 'gym-api.humans.tech',
        'SITE_URL': 'http://localhost:8080' if local else 'https://gym.humans.tech',
        'SUPABASE_PUBLIC_URL': 'http://localhost:8000' if local else 'https://gym-api.humans.tech',
        'TLS_EMAIL': 'marco.ciotoli@humans.tech',
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
        'SMTP_HOST': 'mailpit' if local else '',
        'SMTP_PORT': '1025' if local else '587',
        'SMTP_USER': '',
        'SMTP_PASS': '',
        'SMTP_FROM': 'gym@humans.tech',
        'HTTP_BIND': '127.0.0.1:8080:8080' if local else '80:80',
        'HTTPS_BIND': '127.0.0.1:8000:8000' if local else '443:443',
        'BACKUP_S3_URI': '',
        'AWS_REGION': 'eu-west-1',
        'GITHUB_REPOSITORY': 'humanstech/humans-gym-scheduelr',
        'GITHUB_TOKEN': '',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local', action='store_true')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as file:
        for key, value in generate(args.local).items():
            file.write(f'{key}={value}\n')
    print(f'Environment generated: {args.output}. Complete OAuth, SMTP, region and backup configuration before production.')
