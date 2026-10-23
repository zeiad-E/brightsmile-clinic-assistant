#!/bin/bash
# Applies every migration to a throwaway Postgres + pgvector container (with a small
# Supabase stand-in) and runs the database tests. Requires Docker.
#
# Usage: bash supabase/tests/run-local.sh
set -uo pipefail

cd "$(dirname "$0")/../.."
NAME=brightsmile-db-test
IMAGE=pgvector/pgvector:pg17

docker rm -f "$NAME" >/dev/null 2>&1
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null || exit 1
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT

# Wait until the server accepts connections (the image restarts once after init).
for _ in $(seq 1 60); do
  if docker exec "$NAME" psql -U postgres -tAc 'select 1' >/dev/null 2>&1; then
    sleep 2
    docker exec "$NAME" psql -U postgres -tAc 'select 1' >/dev/null 2>&1 && break
  fi
  sleep 1
done

apply() {
  docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X
}

echo "== applying Supabase stand-in"
apply < supabase/tests/supabase-shim.sql || exit 1

for file in supabase/migrations/*.sql; do
  echo "== applying $(basename "$file")"
  apply < "$file" || { echo "MIGRATION FAILED: $file"; exit 1; }
done

echo "== running tests"
output=$(docker exec -i "$NAME" psql -U postgres -d postgres -q -X < supabase/tests/db-tests.sql 2>&1)
echo "$output" | grep -E "PASS:|FAIL:|ERROR:" | sed -E 's/^(psql:[^ ]+ )?(NOTICE|ERROR): +//'

passed=$(echo "$output" | grep -c "PASS:")
failed=$(echo "$output" | grep -c -E "FAIL:|ERROR:")
echo
echo "== ${passed} passed, ${failed} failed"
[ "$failed" -eq 0 ]
