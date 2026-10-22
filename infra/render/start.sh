#!/bin/bash
# Starts the LLM engine (private, 127.0.0.1:3001) and the backend (public, $PORT).
# If either process exits, the container exits so the platform restarts it.
set -uo pipefail

PUBLIC_PORT="${PORT:-10000}"

# The disk is ephemeral and provider keys are re-applied from FREEAPI_CONFIG_JSON on
# every boot, so a per-boot encryption key is enough unless one is configured
# (configure a stable ENCRYPTION_KEY if encrypted DB backups are enabled).
if [ -z "${ENCRYPTION_KEY:-}" ]; then
  ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  export ENCRYPTION_KEY
fi

echo "[start] launching LLM engine on 127.0.0.1:3001"
(cd /app && PORT=3001 HOST=127.0.0.1 FREELLMAPI_UPDATE_CHECK=off exec node server/dist/index.js) &
ENGINE_PID=$!

ready=0
for _ in $(seq 1 90); do
  if node -e "fetch('http://127.0.0.1:3001/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ready=1
    break
  fi
  if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    echo "[start] LLM engine exited during startup" >&2
    exit 1
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "[start] LLM engine did not become ready in time" >&2
  exit 1
fi
echo "[start] LLM engine ready"

echo "[start] launching backend on 0.0.0.0:${PUBLIC_PORT}"
(cd /srv/backend && PORT="$PUBLIC_PORT" \
  LLM_ENGINE_BASE_URL="${LLM_ENGINE_BASE_URL:-http://127.0.0.1:3001/v1}" \
  exec node src/index.js) &
BACKEND_PID=$!

shutdown() {
  kill -TERM "$ENGINE_PID" "$BACKEND_PID" 2>/dev/null
  wait
}
trap shutdown TERM INT

wait -n "$ENGINE_PID" "$BACKEND_PID"
status=$?
echo "[start] a process exited (status ${status}); stopping container" >&2
kill -TERM "$ENGINE_PID" "$BACKEND_PID" 2>/dev/null
wait
exit "$status"
