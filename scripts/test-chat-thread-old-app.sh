#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_SHA="${CHAT_THREAD_OLD_APP_BASE_SHA:-c677225c7cec3677cd03e2ba4d7c04269518c4c5}"
EXPECTED_BASE_SHA="c677225c7cec3677cd03e2ba4d7c04269518c4c5"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.io/library/postgres:15@sha256:6ab12ad4395ee49ab49fe19530f7e183c5a9c97fc47cf687b3e281bec5f91ee4}"
CONTAINER_NAME="erp4-chat-thread-old-app-$$"
SCRATCH_ROOT="$ROOT_DIR/.codex-local/tmp/chat-thread-old-app-$$"
OLD_APP_ROOT="$SCRATCH_ROOT/old-app"
TEST_DATABASE="erp4_chat_thread_old_app_test"
TEST_USER="erp4_chat_thread_old_app_test"
TEST_PASSWORD="$(
  node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))'
)"

if [[ "$BASE_SHA" != "$EXPECTED_BASE_SHA" ]]; then
  echo "Refusing an unreviewed old-app compatibility baseline" >&2
  exit 1
fi
git -C "$ROOT_DIR" cat-file -e "${BASE_SHA}^{commit}"
mkdir -p "$OLD_APP_ROOT"
chmod 700 "$SCRATCH_ROOT"

cleanup() {
  podman stop --time 5 "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [[ -d "$SCRATCH_ROOT" && "$SCRATCH_ROOT" == "$ROOT_DIR/.codex-local/tmp/chat-thread-old-app-"* ]]; then
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
  if podman exec "$CONTAINER_NAME" pg_isready -U "$TEST_USER" -d "$TEST_DATABASE" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
podman exec "$CONTAINER_NAME" pg_isready -U "$TEST_USER" -d "$TEST_DATABASE" >/dev/null
HOST_PORT="$(podman port "$CONTAINER_NAME" 5432/tcp | sed -n 's/.*://p' | tail -n 1)"
if [[ ! "$HOST_PORT" =~ ^[0-9]+$ ]]; then
  echo "Unable to determine ephemeral PostgreSQL port" >&2
  exit 1
fi

export DATABASE_URL="postgresql://${TEST_USER}:${TEST_PASSWORD}@127.0.0.1:${HOST_PORT}/${TEST_DATABASE}?schema=public"
export NODE_ENV=test
export AUTH_MODE=header
export KNOWLEDGE_CURSOR_SIGNING_SECRET="chat-thread-old-app-compatibility-secret-0001"
export CHAT_THREAD_OLD_APP_CONFIRM=1
export CHAT_THREAD_OLD_APP_BASE_SHA="$BASE_SHA"
export OLD_APP_ROOT
export CURRENT_APP_ROOT="$ROOT_DIR"

npm ci --prefix "$OLD_APP_ROOT/packages/backend" >/dev/null
npm run prisma:generate --prefix "$OLD_APP_ROOT/packages/backend" >/dev/null
npx --prefix "$OLD_APP_ROOT/packages/backend" prisma migrate deploy \
  --config "$OLD_APP_ROOT/packages/backend/prisma.config.ts" >/dev/null
OLD_MIGRATIONS="$(find "$OLD_APP_ROOT/packages/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"
npm run build --prefix "$OLD_APP_ROOT/packages/backend" >/dev/null

export CHAT_THREAD_OLD_APP_MODE=seed
node "$ROOT_DIR/packages/backend/scripts/chat-thread-old-app-compat.mjs"

npx --prefix "$ROOT_DIR/packages/backend" prisma migrate deploy \
  --config "$ROOT_DIR/packages/backend/prisma.config.ts" >/dev/null
npx --prefix "$ROOT_DIR/packages/backend" prisma migrate status \
  --config "$ROOT_DIR/packages/backend/prisma.config.ts" >/dev/null
NEW_MIGRATIONS="$(find "$ROOT_DIR/packages/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"
npm run prisma:generate --prefix "$ROOT_DIR/packages/backend" >/dev/null
npm run build --prefix "$ROOT_DIR/packages/backend" >/dev/null

export CHAT_THREAD_OLD_APP_MODE=current-before
node "$ROOT_DIR/packages/backend/scripts/chat-thread-old-app-compat.mjs"
export CHAT_THREAD_OLD_APP_MODE=old-after
node "$ROOT_DIR/packages/backend/scripts/chat-thread-old-app-compat.mjs"
export CHAT_THREAD_OLD_APP_MODE=current-after
node "$ROOT_DIR/packages/backend/scripts/chat-thread-old-app-compat.mjs"

printf '{"baseline":"%s","oldMigrations":%s,"newMigrations":%s,"existingChatDataRetained":true,"oldClientWriteAfterMigration":true,"oldResponseStable":true}\n' \
  "$BASE_SHA" "$OLD_MIGRATIONS" "$NEW_MIGRATIONS"
echo "chat thread old-application compatibility: PASS"
