#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="${CONTAINER_NAME:-erp4-pg-poc}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
HOST_PORT="${HOST_PORT:-55432}"
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"

usage() {
  cat <<USAGE
Usage: $0 <start|db-push|seed|check|stop|reset>

start   : start postgres container (if missing, create)
db-push : apply prisma schema via node container
seed    : run scripts/seed-demo.sql inside container
check   : run scripts/checks/poc-integrity.sql inside container
stop    : stop and remove postgres container
reset   : stop + start + db-push + seed + check
USAGE
}

container_exists() {
  podman ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"
}

container_running() {
  podman ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"
}

wait_ready() {
  for _ in $(seq 1 30); do
    if podman exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "postgres not ready" >&2
  exit 1
}

start_container() {
  if container_exists; then
    if ! container_running; then
      podman start "$CONTAINER_NAME" >/dev/null
    fi
  else
    podman run -d --name "$CONTAINER_NAME" \
      -e POSTGRES_USER="$DB_USER" \
      -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      -e POSTGRES_DB="$DB_NAME" \
      -v "$ROOT_DIR":/workspace:ro \
      -p "$HOST_PORT":5432 \
      docker.io/library/postgres:15 >/dev/null
  fi
  wait_ready
  echo "postgres ready: $CONTAINER_NAME"
}

db_push() {
  podman run --rm \
    --network container:"$CONTAINER_NAME" \
    -v "$ROOT_DIR":/workspace \
    -w /workspace \
    -e DATABASE_URL="$DB_URL" \
    docker.io/library/node:20-bookworm \
    npx --prefix packages/backend prisma db push --schema=prisma/schema.prisma --skip-generate
}

seed() {
  podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -f /workspace/scripts/seed-demo.sql
}

check() {
  podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -f /workspace/scripts/checks/poc-integrity.sql
}

stop_container() {
  if container_exists; then
    podman stop "$CONTAINER_NAME" >/dev/null || true
    podman rm "$CONTAINER_NAME" >/dev/null || true
  fi
}

cmd="${1:-}"
case "$cmd" in
  start)
    start_container
    ;;
  db-push)
    start_container
    db_push
    ;;
  seed)
    start_container
    seed
    ;;
  check)
    start_container
    check
    ;;
  stop)
    stop_container
    ;;
  reset)
    stop_container
    start_container
    db_push
    seed
    check
    ;;
  *)
    usage
    exit 1
    ;;
esac
