#!/usr/bin/env bash
# Shared host: never install packages or modify Docker, firewall or other projects.
set -euo pipefail
if [[ $(id -u) != 0 ]]; then echo 'Run with sudo.' >&2; exit 1; fi
if [[ $(uname -m) != aarch64 ]]; then echo 'Production requires native ARM64.' >&2; exit 1; fi
for command in docker python3 git ss; do command -v "$command" >/dev/null; done
docker compose version
bash "$(dirname "$0")/install-services.sh"
if [[ ! -f /opt/gym/.env ]]; then
  python3 "$(dirname "$0")/make-env.py" --output /opt/gym/.env
fi
echo 'Gym prepared. Complete /opt/gym/.env and follow docs/PRODUCTION.md. Timers remain disabled.'
