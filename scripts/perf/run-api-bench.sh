#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTAINER_NAME="${CONTAINER_NAME:-erp4-pg-perf}"
HOST_PORT="${HOST_PORT:-55434}"
BACKEND_PORT="${BACKEND_PORT:-3003}"
PROJECT_ID="${PROJECT_ID:-00000000-0000-0000-0000-000000000001}"
DATE_TAG="${DATE_TAG:-$(date +%Y-%m-%d)}"
RUN_LABEL="${RUN_LABEL:-baseline}"

DATABASE_URL="postgresql://postgres:postgres@localhost:${HOST_PORT}/postgres?schema=public"
BACKEND_LOG="$ROOT_DIR/tmp/perf-backend.log"
OUT_FILE="$ROOT_DIR/docs/test-results/perf-${DATE_TAG}.md"
DB_RESET_LOG="$ROOT_DIR/tmp/perf-db-reset.log"

mkdir -p "$ROOT_DIR/tmp"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" || true
  fi
  local pid
  pid=$(ss -ltnp | awk -v p=":${BACKEND_PORT}" '$4 ~ p { if (match($0, /pid=([0-9]+)/, a)) print a[1]; }' | head -n 1)
  if [[ -n "${pid:-}" ]]; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ ! -f "$OUT_FILE" ]]; then
  echo "# Performance results (${DATE_TAG})" > "$OUT_FILE"
  echo "" >> "$OUT_FILE"
fi

cat >>"$OUT_FILE" <<EOF

## Run: ${RUN_LABEL}

- commit: $(git rev-parse HEAD)
- db: podman (${CONTAINER_NAME})
- tools: node $(node -v), podman $(podman --version | sed 's/^podman version //'), autocannon@8.0.0
- endpoints: /projects, /reports/project-profit, /reports/project-profit/by-user

### Setup
- DB reset log: \`tmp/perf-db-reset.log\`

EOF

echo "== DB reset ==" | tee -a "$OUT_FILE"
CONTAINER_NAME="$CONTAINER_NAME" HOST_PORT="$HOST_PORT" "$ROOT_DIR/scripts/podman-poc.sh" reset >"$DB_RESET_LOG" 2>&1
echo "ok" | tee -a "$OUT_FILE"

echo "" >> "$OUT_FILE"
echo "== Perf seed ==" | tee -a "$OUT_FILE"
podman exec -e PGPASSWORD=postgres "$CONTAINER_NAME" \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /workspace/scripts/perf/seed-perf.sql >/dev/null
echo "ok" | tee -a "$OUT_FILE"

echo "" >> "$OUT_FILE"
echo "== Dataset counts ==" | tee -a "$OUT_FILE"
podman exec -e PGPASSWORD=postgres "$CONTAINER_NAME" \
  psql -U postgres -d postgres -tA -c "select count(*) from \"TimeEntry\" where \"userId\"='perf-user';" \
  | awk '{print "- timeEntries(perf-user): " $1}' | tee -a "$OUT_FILE"
podman exec -e PGPASSWORD=postgres "$CONTAINER_NAME" \
  psql -U postgres -d postgres -tA -c "select count(*) from \"Expense\" where \"userId\"='perf-user';" \
  | awk '{print "- expenses(perf-user): " $1}' | tee -a "$OUT_FILE"
podman exec -e PGPASSWORD=postgres "$CONTAINER_NAME" \
  psql -U postgres -d postgres -tA -c "select count(*) from \"RateCard\" where role='perf';" \
  | awk '{print "- rateCards(role=perf): " $1}' | tee -a "$OUT_FILE"

if [[ ! -d "$ROOT_DIR/packages/backend/node_modules" ]]; then
  npm install --prefix "$ROOT_DIR/packages/backend"
fi

echo "" >> "$OUT_FILE"
echo "== Build backend ==" | tee -a "$OUT_FILE"
npm run prisma:generate --prefix "$ROOT_DIR/packages/backend" >/dev/null
npm run build --prefix "$ROOT_DIR/packages/backend" >/dev/null
echo "ok" | tee -a "$OUT_FILE"

echo "" >> "$OUT_FILE"
echo "== Start backend ==" | tee -a "$OUT_FILE"
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
  echo "backend not ready" | tee -a "$OUT_FILE"
  if [[ -f "$BACKEND_LOG" ]]; then
    echo "backend log tail:" | tee -a "$OUT_FILE"
    tail -n 200 "$BACKEND_LOG" | tee -a "$OUT_FILE"
  fi
  exit 1
fi

echo "" >> "$OUT_FILE"
echo "== pg_stat_statements reset ==" | tee -a "$OUT_FILE"
CONTAINER_NAME="$CONTAINER_NAME" HOST_PORT="$HOST_PORT" "$ROOT_DIR/scripts/podman-poc.sh" stats-reset | tee -a "$OUT_FILE"

echo "" >> "$OUT_FILE"
echo "== Bench ==" | tee -a "$OUT_FILE"
echo "" >> "$OUT_FILE"

AUTH_HEADERS=(-H "x-user-id: perf-user" -H "x-roles: admin")
BASE_URL="http://localhost:${BACKEND_PORT}"

run_autocannon() {
  local label=$1
  local url=$2
  echo "### ${label}" | tee -a "$OUT_FILE"
  echo "\`\`\`" >> "$OUT_FILE"
  npx --yes autocannon@8.0.0 -c 10 -d 20 "${AUTH_HEADERS[@]}" "$url" 2>&1 | tee -a "$OUT_FILE"
  echo "\`\`\`" >> "$OUT_FILE"
  echo "" >> "$OUT_FILE"
}

run_autocannon "GET /projects" "${BASE_URL}/projects"
run_autocannon "GET /reports/project-profit/:projectId" "${BASE_URL}/reports/project-profit/${PROJECT_ID}"
run_autocannon "GET /reports/project-profit/:projectId/by-user" "${BASE_URL}/reports/project-profit/${PROJECT_ID}/by-user"

echo "" >> "$OUT_FILE"
echo "== pg_stat_statements ==" | tee -a "$OUT_FILE"
CONTAINER_NAME="$CONTAINER_NAME" HOST_PORT="$HOST_PORT" "$ROOT_DIR/scripts/podman-poc.sh" stats | tee -a "$OUT_FILE"

echo "" >> "$OUT_FILE"
echo "backend log: $BACKEND_LOG" | tee -a "$OUT_FILE"
echo "result: $OUT_FILE"
