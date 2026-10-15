#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env.stack.local ]]; then
  python3 scripts/make-env.py --local --output .env.stack.local
else
  # Older files: add DEV_LOGIN_PASSWORD / ADDITIONAL_REDIRECT_URLS, never regenerating secrets.
  python3 scripts/make-env.py --local --add-missing --output .env.stack.local >/dev/null
fi
compose=(docker compose --project-name gym-local --env-file .env.stack.local -f deploy/compose.yml -f deploy/local.yml)
stack() { python3 scripts/stack.py "$@" --env-file .env.stack.local --project gym-local; }
case "${1:-up}" in
  up)
    "${compose[@]}" up -d --wait --wait-timeout 300 db auth rest realtime gateway mailpit
    stack migrate
    stack seed
    "${compose[@]}" build web
    "${compose[@]}" up -d --wait --wait-timeout 180 web
    stack dev-users
    echo 'App: http://localhost:8080 | API: http://localhost:8080 | local email: http://localhost:8025'
    echo 'Quick login: profiles listed on the login page (local build only, no email sent)'
    ;;
  dev-users) stack dev-users ;;
  dev-env) stack dev-env --output .env.local ;;
  down) "${compose[@]}" down ;;
  logs) "${compose[@]}" logs --tail=50 ;;
  *) echo 'Usage: scripts/local.sh up|dev-users|dev-env|down|logs' >&2; exit 1 ;;
esac
