#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
ENV_FILE="${POSTGRES_ENV_FILE:-$TARGET_DIR/erp4-postgres.env}"
ENV_FILE_EXPLICIT=0
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-${POSTGRES_CONTAINER:-erp4-postgres}}"
BACKUP_PREFIX=""
DB_FILE=""
GLOBALS_FILE=""
SKIP_GLOBALS=0
CLEAN_PUBLIC_SCHEMA=0
PODMAN_EXEC_ENV_FILE=""

usage() {
  cat <<USAGE
Usage: RESTORE_CONFIRM=1 $(basename "$0") [options]
  -h, --help             Show this help message and exit
  --target-dir DIR       Quadlet config directory (default: ~/.config/containers/systemd)
  --env-file PATH        PostgreSQL env file path (default: <target-dir>/erp4-postgres.env)
  --container NAME       PostgreSQL container name (default: POSTGRES_CONTAINER/POSTGRES_CONTAINER_NAME/erp4-postgres)
  --backup-prefix PATH   Backup prefix without .dump / -db.dump / -globals.sql suffix
  --db-file PATH         Database dump file (.dump or -db.dump)
  --globals-file PATH    Globals SQL file
  --skip-globals         Skip globals restore even if globals file exists
  --clean-public-schema  Drop/recreate public schema and restore default schema grants before restore
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

cleanup() {
  [[ -n "$PODMAN_EXEC_ENV_FILE" ]] && rm -f -- "$PODMAN_EXEC_ENV_FILE"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

read_env_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      pos = index($0, "=")
      if (pos == 0) {
        next
      }
      env_key = substr($0, 1, pos - 1)
      env_value = substr($0, pos + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", env_key)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", env_value)
      if (env_key == key) {
        if (env_value ~ /^".*"$/ || env_value ~ /^'"'"'.*'"'"'$/) {
          env_value = substr(env_value, 2, length(env_value) - 2)
        }
        print env_value
        exit
      }
    }
  ' "$file"
}

derive_globals_file() {
  local db_file="$1"
  case "$db_file" in
    *-db.dump)
      printf '%s-globals.sql\n' "${db_file%-db.dump}"
      ;;
    *.dump)
      printf '%s-globals.sql\n' "${db_file%.dump}"
      ;;
    *)
      return 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --target-dir'
      TARGET_DIR="$2"
      if [[ "$ENV_FILE_EXPLICIT" -eq 0 ]]; then
        ENV_FILE="$TARGET_DIR/erp4-postgres.env"
      fi
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || fail 'missing argument for --env-file'
      ENV_FILE="$2"
      ENV_FILE_EXPLICIT=1
      shift 2
      ;;
    --container)
      [[ $# -ge 2 ]] || fail 'missing argument for --container'
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --backup-prefix)
      [[ $# -ge 2 ]] || fail 'missing argument for --backup-prefix'
      BACKUP_PREFIX="$2"
      shift 2
      ;;
    --db-file)
      [[ $# -ge 2 ]] || fail 'missing argument for --db-file'
      DB_FILE="$2"
      shift 2
      ;;
    --globals-file)
      [[ $# -ge 2 ]] || fail 'missing argument for --globals-file'
      GLOBALS_FILE="$2"
      shift 2
      ;;
    --skip-globals)
      SKIP_GLOBALS=1
      shift
      ;;
    --clean-public-schema)
      CLEAN_PUBLIC_SCHEMA=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

trap cleanup EXIT
require_cmd mktemp
require_cmd podman
[[ "${RESTORE_CONFIRM:-}" == "1" ]] || fail 'RESTORE_CONFIRM=1 is required for restore'
[[ -f "$ENV_FILE" ]] || fail "PostgreSQL env file not found: $ENV_FILE"
[[ -n "$BACKUP_PREFIX" || -n "$DB_FILE" ]] || fail 'either --backup-prefix or --db-file is required'
if [[ -n "$BACKUP_PREFIX" && -n "$DB_FILE" ]]; then
  fail '--backup-prefix and --db-file cannot be used together'
fi
if [[ -n "$BACKUP_PREFIX" && -n "$GLOBALS_FILE" ]]; then
  fail '--backup-prefix and --globals-file cannot be used together'
fi
if [[ -n "$BACKUP_PREFIX" ]]; then
  if [[ -f "${BACKUP_PREFIX}.dump" ]]; then
    DB_FILE="${BACKUP_PREFIX}.dump"
  elif [[ -f "${BACKUP_PREFIX}-db.dump" ]]; then
    DB_FILE="${BACKUP_PREFIX}-db.dump"
  else
    fail "database backup file not found for prefix: ${BACKUP_PREFIX}.dump or ${BACKUP_PREFIX}-db.dump"
  fi
  GLOBALS_FILE="${BACKUP_PREFIX}-globals.sql"
fi

if [[ -n "$DB_FILE" && -z "$GLOBALS_FILE" && "$SKIP_GLOBALS" -eq 0 ]]; then
  if derived_globals_file="$(derive_globals_file "$DB_FILE")" && [[ -f "$derived_globals_file" ]]; then
    GLOBALS_FILE="$derived_globals_file"
  else
    warn 'globals file not provided or not found; skipping globals restore'
    SKIP_GLOBALS=1
  fi
fi

[[ -f "$DB_FILE" ]] || fail "database backup file not found: $DB_FILE"
if [[ "$SKIP_GLOBALS" -eq 0 ]]; then
  [[ -n "$GLOBALS_FILE" ]] || fail 'globals restore is enabled but globals file is not set'
  [[ -f "$GLOBALS_FILE" ]] || fail "globals backup file not found: $GLOBALS_FILE"
fi

POSTGRES_USER="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
POSTGRES_PASSWORD="$(read_env_value "$ENV_FILE" POSTGRES_PASSWORD)"
POSTGRES_DB="$(read_env_value "$ENV_FILE" POSTGRES_DB)"

[[ -n "$POSTGRES_USER" ]] || fail "missing or empty required key in $ENV_FILE: POSTGRES_USER"
[[ -n "$POSTGRES_PASSWORD" ]] || fail "missing or empty required key in $ENV_FILE: POSTGRES_PASSWORD"
[[ -n "$POSTGRES_DB" ]] || fail "missing or empty required key in $ENV_FILE: POSTGRES_DB"

PODMAN_EXEC_ENV_FILE="$(mktemp)"
chmod 600 "$PODMAN_EXEC_ENV_FILE"
printf 'PGPASSWORD=%s\n' "$POSTGRES_PASSWORD" > "$PODMAN_EXEC_ENV_FILE"

if [[ "$CLEAN_PUBLIC_SCHEMA" -eq 1 ]]; then
  podman exec --env-file "$PODMAN_EXEC_ENV_FILE" "$CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' \
    -c "GRANT ALL ON SCHEMA public TO \"$POSTGRES_USER\";" \
    -c 'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '\''pg_database_owner'\'') THEN GRANT ALL ON SCHEMA public TO pg_database_owner; END IF; END $$;' \
    -c 'GRANT USAGE ON SCHEMA public TO PUBLIC;'
  printf 'OK: recreated public schema and restored default schema grants in %s\n' "$POSTGRES_DB"
fi

if [[ "$SKIP_GLOBALS" -eq 0 ]]; then
  podman exec -i --env-file "$PODMAN_EXEC_ENV_FILE" "$CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" postgres < "$GLOBALS_FILE"
  printf 'OK: restored globals from %s\n' "$GLOBALS_FILE"
else
  warn 'skipping globals restore'
fi

podman exec -i --env-file "$PODMAN_EXEC_ENV_FILE" "$CONTAINER_NAME" \
  pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$DB_FILE"
printf 'OK: restored database from %s\n' "$DB_FILE"
