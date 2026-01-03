#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="${CONTAINER_NAME:-erp4-pg-poc}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
HOST_PORT="${HOST_PORT:-55432}"
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.io/library/postgres:15}"
POSTGRES_EXTRA_ARGS="${POSTGRES_EXTRA_ARGS:--c shared_preload_libraries=pg_stat_statements -c track_io_timing=on}"

usage() {
  cat <<USAGE
Usage: $0 <start|db-push|migrate|seed|check|stats|stats-reset|stop|reset>

start   : start postgres container (if missing, create)
db-push : apply prisma schema via node container
migrate : apply prisma migrations via node container
seed    : run scripts/seed-demo.sql inside container
check   : run scripts/checks/poc-integrity.sql inside container
stats   : run scripts/checks/pg-stat-statements.sql inside container
stats-reset : reset pg_stat_statements counters inside container
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
      "$POSTGRES_IMAGE" $POSTGRES_EXTRA_ARGS >/dev/null
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
    npx --prefix packages/backend prisma db push --schema=packages/backend/prisma/schema.prisma --skip-generate
}

migrate_deploy() {
  podman run --rm \
    --network container:"$CONTAINER_NAME" \
    -v "$ROOT_DIR":/workspace \
    -w /workspace \
    -e DATABASE_URL="$DB_URL" \
    docker.io/library/node:20-bookworm \
    npx --prefix packages/backend prisma migrate deploy --schema=packages/backend/prisma/schema.prisma
}

seed() {
  podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -f /workspace/scripts/seed-demo.sql
}

check() {
  podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -f /workspace/scripts/checks/poc-integrity.sql
}

pg_stat_enabled() {
  local libs
  libs=$(podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -tA -c "SHOW shared_preload_libraries;")
  [[ "$libs" == *pg_stat_statements* ]]
}

enable_pg_stat() {
  if ! pg_stat_enabled; then
    echo "pg_stat_statements is not enabled. Run 'reset' or start the container with POSTGRES_EXTRA_ARGS='-c shared_preload_libraries=pg_stat_statements' (and any other desired flags)." >&2
    return 1
  fi
  podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
}

stats() {
  start_container
  enable_pg_stat
  podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -f /workspace/scripts/checks/pg-stat-statements.sql
}

stats_reset() {
  start_container
  enable_pg_stat
  podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -f /workspace/scripts/checks/pg-stat-reset.sql
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
  migrate)
    start_container
    migrate_deploy
    ;;
  seed)
    start_container
    seed
    ;;
  check)
    start_container
    check
    ;;
  stats)
    stats
    ;;
  stats-reset)
    stats_reset
    ;;
  stop)
    stop_container
    ;;
  reset)
    stop_container
    start_container
    migrate_deploy
    seed
    check
    ;;
  *)
    usage
    exit 1
    ;;
esac
