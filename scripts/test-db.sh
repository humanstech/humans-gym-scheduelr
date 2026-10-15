#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_container="gym-db-test-$$"
trap 'docker rm -f "$test_container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$test_container" -e POSTGRES_PASSWORD=isolated-test-only postgres:17.6-alpine >/dev/null
# Probe over TCP: the image's init phase runs a temporary socket-only server and
# then restarts it, so a socket probe can succeed just before that restart.
ready=false
for ((i=0; i<60; i++)); do
  if docker exec "$test_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if ! $ready; then echo 'PostgreSQL test container did not become ready' >&2; exit 1; fi
docker exec -i "$test_container" psql -X -U postgres -v ON_ERROR_STOP=1 < supabase/tests/bootstrap.sql >/dev/null
# pg_cron schedule files (0002, 0003, 0005) need the extension and are skipped here.
for migration in supabase/migrations/202610150001_initial.sql supabase/migrations/202610150004_personal_trainer.sql; do
  docker exec -i "$test_container" psql -X -U postgres -v ON_ERROR_STOP=1 -1 < "$migration" >/dev/null
done
GYM_TEST_CONTAINER="$test_container" python3 supabase/tests/checks.py
GYM_TEST_CONTAINER="$test_container" python3 supabase/tests/pt_checks.py
