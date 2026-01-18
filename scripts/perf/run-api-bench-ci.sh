#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

OUT_DIR="${OUT_DIR:-$ROOT_DIR/tmp/perf-ci}"
BACKEND_PORT="${BACKEND_PORT:-3003}"
PROJECT_ID="${PROJECT_ID:-00000000-0000-0000-0000-000000000001}"

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
PSQL_URL="${DATABASE_URL%%\?*}"

BACKEND_LOG="${OUT_DIR}/backend.log"

mkdir -p "$OUT_DIR"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" || true
  fi
}
trap cleanup EXIT

echo "== Install backend deps =="
npm ci --prefix "$ROOT_DIR/packages/backend" >/dev/null

echo "== Prisma generate =="
npx --prefix "$ROOT_DIR/packages/backend" prisma generate --schema="$ROOT_DIR/packages/backend/prisma/schema.prisma" >/dev/null

echo "== Prisma migrate deploy =="
npx --prefix "$ROOT_DIR/packages/backend" prisma migrate deploy --schema="$ROOT_DIR/packages/backend/prisma/schema.prisma" >/dev/null

echo "== Seed demo =="
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/scripts/seed-demo.sql" >/dev/null

echo "== Seed perf =="
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/scripts/perf/seed-perf.sql" >/dev/null

echo "== Build backend =="
npm run build --prefix "$ROOT_DIR/packages/backend" >/dev/null

echo "== Start backend =="
cleanup
PORT="$BACKEND_PORT" AUTH_MODE=header DATABASE_URL="$DATABASE_URL" \
  node "$ROOT_DIR/packages/backend/dist/index.js" >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 40); do
  if curl -sf "http://localhost:${BACKEND_PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -sf "http://localhost:${BACKEND_PORT}/healthz" >/dev/null 2>&1; then
  echo "backend not ready"
  echo "backend log tail:"
  tail -n 200 "$BACKEND_LOG" || true
  exit 1
fi

echo "== Bench =="
node "$ROOT_DIR/scripts/perf/run-api-bench-ci.mjs" \
  --base-url "http://localhost:${BACKEND_PORT}" \
  --project-id "$PROJECT_ID" \
  --out-json "${OUT_DIR}/result.json" \
  --out-md "${OUT_DIR}/result.md"

echo "== Done =="
echo "- json: ${OUT_DIR}/result.json"
echo "- md: ${OUT_DIR}/result.md"
echo "- backend log: ${BACKEND_LOG}"

