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

if [ "${1:-}" = "--seed" ]; then
  echo "== applying seed.sql (twice, to prove re-runs are safe)"
  apply < supabase/seed.sql || { echo "SEED FAILED"; exit 1; }
  apply < supabase/seed.sql || { echo "SEED RE-RUN FAILED"; exit 1; }
  docker exec -i "$NAME" psql -U postgres -d postgres -X -q <<'SQL'
select 'doctors' as item, count(*) from public.staff
union all select 'services', count(*) from public.services
union all select 'doctor-service links', count(*) from public.staff_services
union all select 'working-hour rows', count(*) from public.working_hours
union all select 'knowledge docs (en)', count(*) from public.knowledge_docs where language = 'en'
union all select 'knowledge docs (ar)', count(*) from public.knowledge_docs where language = 'ar'
union all select 'patients', count(*) from public.patients
union all select 'upcoming bookings', count(*) from public.appointments where status = 'booked'
union all select 'past visits', count(*) from public.appointments where status = 'completed'
union all select 'open escalations', count(*) from public.escalations where status = 'open';
SQL
  exit 0
fi

echo "== running tests"
output=$(docker exec -i "$NAME" psql -U postgres -d postgres -q -X < supabase/tests/db-tests.sql 2>&1)
echo "$output" | grep -E "PASS:|FAIL:|ERROR:" | sed -E 's/^(psql:[^ ]+ )?(NOTICE|ERROR): +//'

passed=$(echo "$output" | grep -c "PASS:")
failed=$(echo "$output" | grep -c -E "FAIL:|ERROR:")
echo
echo "== ${passed} passed, ${failed} failed"
[ "$failed" -eq 0 ]
