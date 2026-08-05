#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="erp4-knowledge-snapshot-test-$$"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.io/library/postgres:15@sha256:6ab12ad4395ee49ab49fe19530f7e183c5a9c97fc47cf687b3e281bec5f91ee4}"
TEST_DATABASE="erp4_knowledge_snapshot_test"
TEST_USER="erp4_snapshot_test"
TEST_PASSWORD="$(${NODE_BINARY:-node} -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
SCRATCH_ROOT="$ROOT_DIR/.codex-local/tmp/knowledge-snapshot-integration-$$"
STORAGE_DIR="$SCRATCH_ROOT/artifacts"

mkdir -p "$STORAGE_DIR"
chmod 700 "$SCRATCH_ROOT" "$STORAGE_DIR"

cleanup() {
  podman stop --time 5 "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [[ -d "$SCRATCH_ROOT" && "$SCRATCH_ROOT" == "$ROOT_DIR/.codex-local/tmp/knowledge-snapshot-integration-"* ]]; then
    find "$SCRATCH_ROOT" -xdev -depth -delete
  fi
}
trap cleanup EXIT INT TERM

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
export KNOWLEDGE_SNAPSHOT_INTEGRATION_CONFIRM=1
export KNOWLEDGE_SNAPSHOT_INTEGRATION_ROOT="$ROOT_DIR"
export KNOWLEDGE_SNAPSHOT_PROVIDER=local
export KNOWLEDGE_STORAGE_DIR="$STORAGE_DIR"

npm run prisma:generate --prefix "$ROOT_DIR/packages/backend" >/dev/null
npx --prefix "$ROOT_DIR/packages/backend" prisma migrate deploy \
  --config "$ROOT_DIR/packages/backend/prisma.config.ts" >/dev/null
npm run build --prefix "$ROOT_DIR/packages/backend" >/dev/null
node "$ROOT_DIR/packages/backend/scripts/knowledge-snapshot-integration.mjs"
npx --prefix "$ROOT_DIR/packages/backend" prisma migrate status \
  --config "$ROOT_DIR/packages/backend/prisma.config.ts" >/dev/null

echo "knowledge snapshot PostgreSQL/local-storage integration: PASS"
