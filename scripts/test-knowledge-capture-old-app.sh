#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_SHA="${KNOWLEDGE_CAPTURE_OLD_APP_BASE_SHA:-63351daafeba589fca402edb8ebae451256d6dae}"
EXPECTED_BASE_SHA="63351daafeba589fca402edb8ebae451256d6dae"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.io/library/postgres:15@sha256:6ab12ad4395ee49ab49fe19530f7e183c5a9c97fc47cf687b3e281bec5f91ee4}"
CONTAINER_NAME="erp4-knowledge-capture-old-app-$$"
SCRATCH_ROOT="$ROOT_DIR/.codex-local/tmp/knowledge-capture-old-app-$$"
OLD_APP_ROOT="$SCRATCH_ROOT/old-app"
TEST_DATABASE="erp4_knowledge_capture_old_app_test"
TEST_USER="erp4_knowledge_capture_old_app_test"
TEST_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"

[[ "$BASE_SHA" == "$EXPECTED_BASE_SHA" ]] || { echo "Refusing an unreviewed capture old-app baseline" >&2; exit 1; }
git -C "$ROOT_DIR" cat-file -e "${BASE_SHA}^{commit}"
mkdir -p "$OLD_APP_ROOT"
chmod 700 "$SCRATCH_ROOT"

OLD_SERVER_PID=""
cleanup() {
  if [[ -n "$OLD_SERVER_PID" ]]; then kill "$OLD_SERVER_PID" >/dev/null 2>&1 || true; fi
  podman stop --time 5 "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [[ -d "$SCRATCH_ROOT" && "$SCRATCH_ROOT" == "$ROOT_DIR/.codex-local/tmp/knowledge-capture-old-app-"* ]]; then
    find "$SCRATCH_ROOT" -xdev -depth -delete
  fi
}
trap cleanup EXIT INT TERM

git -C "$ROOT_DIR" archive "$BASE_SHA" | tar -x -C "$OLD_APP_ROOT"
podman run --rm -d \
  --name "$CONTAINER_NAME" \
  --tmpfs /var/lib/postgresql/data:rw,size=1g \
  -p 127.0.0.1::5432 \
  -e POSTGRES_DB="$TEST_DATABASE" \
  -e POSTGRES_USER="$TEST_USER" \
  -e POSTGRES_PASSWORD="$TEST_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  podman exec "$CONTAINER_NAME" pg_isready -U "$TEST_USER" -d "$TEST_DATABASE" >/dev/null 2>&1 && break
  sleep 1
done
podman exec "$CONTAINER_NAME" pg_isready -U "$TEST_USER" -d "$TEST_DATABASE" >/dev/null
HOST_PORT="$(podman port "$CONTAINER_NAME" 5432/tcp | sed -n 's/.*://p' | tail -n 1)"
[[ "$HOST_PORT" =~ ^[0-9]+$ ]] || { echo "Unable to determine PostgreSQL port" >&2; exit 1; }

export DATABASE_URL="postgresql://${TEST_USER}:${TEST_PASSWORD}@127.0.0.1:${HOST_PORT}/${TEST_DATABASE}?schema=public"
export NODE_ENV=test
export AUTH_MODE=header
export KNOWLEDGE_CURSOR_SIGNING_SECRET="knowledge-capture-old-app-compat-secret-0001"
export OLD_APP_ROOT CURRENT_APP_ROOT="$ROOT_DIR"

npm ci --prefix "$OLD_APP_ROOT/packages/backend" >/dev/null
npm run prisma:generate --prefix "$OLD_APP_ROOT/packages/backend" >/dev/null
npx --prefix "$OLD_APP_ROOT/packages/backend" prisma migrate deploy \
  --config "$OLD_APP_ROOT/packages/backend/prisma.config.ts" >/dev/null
npm run build --prefix "$OLD_APP_ROOT/packages/backend" >/dev/null

export KNOWLEDGE_CAPTURE_OLD_APP_MODE=old-seed
node "$ROOT_DIR/packages/backend/scripts/knowledge-capture-old-app-compat.mjs"
npx --prefix "$ROOT_DIR/packages/backend" prisma migrate deploy \
  --config "$ROOT_DIR/packages/backend/prisma.config.ts" >/dev/null
npm run prisma:generate --prefix "$ROOT_DIR/packages/backend" >/dev/null
npm run build --prefix "$ROOT_DIR/packages/backend" >/dev/null

export KNOWLEDGE_CAPTURE_OLD_APP_MODE=current-create
node "$ROOT_DIR/packages/backend/scripts/knowledge-capture-old-app-compat.mjs"
export KNOWLEDGE_CAPTURE_OLD_APP_MODE=old-after
node "$ROOT_DIR/packages/backend/scripts/knowledge-capture-old-app-compat.mjs"
export KNOWLEDGE_CAPTURE_OLD_APP_MODE=current-after
node "$ROOT_DIR/packages/backend/scripts/knowledge-capture-old-app-compat.mjs"

OLD_APP_PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
PORT="$OLD_APP_PORT" node "$OLD_APP_ROOT/packages/backend/dist/index.js" >"$SCRATCH_ROOT/old-app-server.log" 2>&1 &
OLD_SERVER_PID=$!
for _ in $(seq 1 60); do
  curl --fail --silent "http://127.0.0.1:${OLD_APP_PORT}/healthz" >/dev/null 2>&1 && break
  sleep 1
done
curl --fail --silent "http://127.0.0.1:${OLD_APP_PORT}/healthz" >/dev/null
curl --fail --silent "http://127.0.0.1:${OLD_APP_PORT}/readyz" >/dev/null
kill "$OLD_SERVER_PID"
wait "$OLD_SERVER_PID" || true
OLD_SERVER_PID=""

printf '{"baseline":"%s","captureSideTable":true,"oldApplicationReadWrite":true,"healthReadiness":true}\n' "$BASE_SHA"
echo "knowledge capture old-application compatibility: PASS"
