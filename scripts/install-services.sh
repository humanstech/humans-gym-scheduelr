#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $(id -u) != 0 ]]; then
  echo 'Run with sudo on the EC2 host.' >&2
  exit 1
fi
install -d -m 700 /etc/slokta /opt/slokta/tools /opt/slokta/backups
install -m 644 scripts/production.py scripts/stack.py /opt/slokta/tools/
install -m 644 deploy/systemd/slokta-* /etc/systemd/system/
systemctl daemon-reload
echo 'Services installed but not enabled. Complete production.env and bootstrap before enabling timers.'
