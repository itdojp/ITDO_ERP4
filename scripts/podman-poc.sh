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
Usage: $0 <start|db-push|migrate|seed|check|stats|stats-reset|backup|restore|stop|reset>

start   : start postgres container (if missing, create)
db-push : apply prisma schema via node container
migrate : apply prisma migrations via node container
seed    : run scripts/seed-demo.sql inside container
check   : run scripts/checks/poc-integrity.sql inside container
stats   : run scripts/checks/pg-stat-statements.sql inside container
stats-reset : reset pg_stat_statements counters inside container
backup  : create SQL and globals dump into BACKUP_DIR (default: ./tmp/erp4-backups)
restore : restore SQL (and globals if present). Requires RESTORE_CONFIRM=1
          options: SKIP_GLOBALS=1, RESTORE_CLEAN=1
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
    npx --prefix packages/backend prisma db push --config packages/backend/prisma.config.ts
}

migrate_deploy() {
  podman run --rm \
    --network container:"$CONTAINER_NAME" \
    -v "$ROOT_DIR":/workspace \
    -w /workspace \
    -e DATABASE_URL="$DB_URL" \
    docker.io/library/node:20-bookworm \
    npx --prefix packages/backend prisma migrate deploy --config packages/backend/prisma.config.ts
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

backup() {
  start_container
  local backup_dir="${BACKUP_DIR:-$ROOT_DIR/tmp/erp4-backups}"
  local prefix="${BACKUP_PREFIX:-erp4}"
  local timestamp="${BACKUP_TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
  local backup_file="${BACKUP_FILE:-$backup_dir/${prefix}-backup-${timestamp}.sql}"
  local globals_file="${BACKUP_GLOBALS_FILE:-$backup_dir/${prefix}-globals-${timestamp}.sql}"
  mkdir -p "$backup_dir"
  if ! podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" > "$backup_file"; then
    echo "backup failed: pg_dump command did not complete successfully" >&2
    exit 1
  fi
  if [[ ! -s "$backup_file" ]]; then
    echo "backup failed: backup file '$backup_file' is empty or missing" >&2
    exit 1
  fi
  if ! podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
    pg_dumpall --globals-only -U "$DB_USER" > "$globals_file"; then
    echo "backup failed: pg_dumpall (globals) command did not complete successfully" >&2
    exit 1
  fi
  if [[ ! -s "$globals_file" ]]; then
    echo "backup failed: globals file '$globals_file' is empty or missing" >&2
    exit 1
  fi
  echo "backup created: $backup_file"
  echo "globals created: $globals_file"
}

restore() {
  if [[ "${RESTORE_CONFIRM:-}" != "1" ]]; then
    echo "RESTORE_CONFIRM=1 is required to run restore" >&2
    exit 1
  fi
  start_container
  local backup_dir="${BACKUP_DIR:-$ROOT_DIR/tmp/erp4-backups}"
  local prefix="${BACKUP_PREFIX:-erp4}"
  local backup_file="${BACKUP_FILE:-}"
  local globals_file="${BACKUP_GLOBALS_FILE:-}"
  if [[ -z "$backup_file" || -z "$globals_file" ]]; then
    if [[ ! -d "$backup_dir" ]]; then
      echo "backup directory '$backup_dir' does not exist. Set BACKUP_DIR or create a backup first." >&2
      exit 1
    fi
  fi
  if [[ -z "$backup_file" ]]; then
    backup_file=$(ls -1t "$backup_dir"/${prefix}-backup-*.sql 2>/dev/null | head -1)
  fi
  if [[ -z "$globals_file" ]]; then
    globals_file=$(ls -1t "$backup_dir"/${prefix}-globals-*.sql 2>/dev/null | head -1)
  fi
  if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
    echo "backup file not found. Set BACKUP_FILE or create a backup first." >&2
    exit 1
  fi
  if [[ "${SKIP_GLOBALS:-}" != "1" ]]; then
    if [[ -z "$globals_file" || ! -f "$globals_file" ]]; then
      echo "globals file not found. Set BACKUP_GLOBALS_FILE or SKIP_GLOBALS=1." >&2
      exit 1
    fi
  fi
  if [[ "${RESTORE_CLEAN:-}" == "1" ]]; then
    podman exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER_NAME" \
      psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
      -c "DROP SCHEMA public CASCADE" \
      -c "CREATE SCHEMA public"
    echo "public schema dropped and recreated (RESTORE_CLEAN=1)"
  fi
  if [[ "${SKIP_GLOBALS:-}" == "1" ]]; then
    echo "skipping globals restore (SKIP_GLOBALS=1)"
  else
    cat "$globals_file" | podman exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER_NAME" \
      psql -U "$DB_USER" -v ON_ERROR_STOP=1
  fi
  cat "$backup_file" | podman exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER_NAME" \
    psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
  echo "restore completed from: $backup_file"
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
  backup)
    backup
    ;;
  restore)
    restore
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
