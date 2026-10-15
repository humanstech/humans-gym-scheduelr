#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_container="gym-db-test-$$"
trap 'docker rm -f "$test_container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$test_container" -e POSTGRES_PASSWORD=isolated-test-only postgres:17.6-alpine >/dev/null
for ((i=0; i<60; i++)); do
  if docker exec "$test_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$test_container" psql -X -U postgres -v ON_ERROR_STOP=1 < supabase/tests/bootstrap.sql >/dev/null
docker exec -i "$test_container" psql -X -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/202610150001_initial.sql >/dev/null
GYM_TEST_CONTAINER="$test_container" python3 supabase/tests/checks.py
