#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env.stack.local ]]; then
  python3 scripts/make-env.py --local --output .env.stack.local
fi
compose=(docker compose --project-name slokta-local --env-file .env.stack.local -f deploy/compose.yml -f deploy/local.yml)
case "${1:-up}" in
  up)
    "${compose[@]}" up -d --wait --wait-timeout 300 db auth rest realtime gateway mailpit
    python3 scripts/stack.py migrate --env-file .env.stack.local --project slokta-local
    python3 scripts/stack.py seed --env-file .env.stack.local --project slokta-local
    "${compose[@]}" build web
    "${compose[@]}" up -d --wait --wait-timeout 180 web
    echo 'App: http://localhost:8080 | API: http://localhost:8000 | local email: http://localhost:8025'
    ;;
  down) "${compose[@]}" down ;;
  logs) "${compose[@]}" logs --tail=50 ;;
  *) echo 'Usage: scripts/local.sh up|down|logs' >&2; exit 1 ;;
esac
