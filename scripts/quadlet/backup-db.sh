#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
ENV_FILE="${POSTGRES_ENV_FILE:-$TARGET_DIR/erp4-postgres.env}"
ENV_FILE_EXPLICIT=0
BACKUP_DIR="${QUADLET_DB_BACKUP_DIR:-$HOME/.local/share/erp4/db-backups}"
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-erp4-postgres}"
TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
SKIP_GLOBALS=0
PRINT_PREFIX=0
DB_TMP_FILE=""
GLOBALS_TMP_FILE=""

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help          Show this help message and exit
  --target-dir DIR    Quadlet config directory (default: ~/.config/containers/systemd)
  --env-file PATH     PostgreSQL env file path (default: <target-dir>/erp4-postgres.env)
  --backup-dir DIR    Output directory for dump files
  --container NAME    PostgreSQL container name (default: erp4-postgres)
  --timestamp TS      Timestamp suffix to use instead of UTC now
  --skip-globals      Skip pg_dumpall --globals-only
  --print-prefix      Print generated backup prefix and exit after backup
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

cleanup() {
  [[ -n "$DB_TMP_FILE" ]] && rm -f -- "$DB_TMP_FILE"
  [[ -n "$GLOBALS_TMP_FILE" ]] && rm -f -- "$GLOBALS_TMP_FILE"
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
    --backup-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --backup-dir'
      BACKUP_DIR="$2"
      shift 2
      ;;
    --container)
      [[ $# -ge 2 ]] || fail 'missing argument for --container'
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --timestamp)
      [[ $# -ge 2 ]] || fail 'missing argument for --timestamp'
      TIMESTAMP="$2"
      shift 2
      ;;
    --skip-globals)
      SKIP_GLOBALS=1
      shift
      ;;
    --print-prefix)
      PRINT_PREFIX=1
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

require_cmd podman
require_cmd date
[[ -f "$ENV_FILE" ]] || fail "PostgreSQL env file not found: $ENV_FILE"
[[ "$TIMESTAMP" =~ ^[A-Za-z0-9._-]+$ ]] || fail "--timestamp contains unsupported characters: $TIMESTAMP"
umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

POSTGRES_USER="$(read_env_value "$ENV_FILE" POSTGRES_USER)"
POSTGRES_PASSWORD="$(read_env_value "$ENV_FILE" POSTGRES_PASSWORD)"
POSTGRES_DB="$(read_env_value "$ENV_FILE" POSTGRES_DB)"

[[ -n "$POSTGRES_USER" ]] || fail "missing or empty required key in $ENV_FILE: POSTGRES_USER"
[[ -n "$POSTGRES_PASSWORD" ]] || fail "missing or empty required key in $ENV_FILE: POSTGRES_PASSWORD"
[[ -n "$POSTGRES_DB" ]] || fail "missing or empty required key in $ENV_FILE: POSTGRES_DB"

prefix="${BACKUP_DIR%/}/erp4-postgres-${TIMESTAMP}"
db_file="${prefix}.dump"
globals_file="${prefix}-globals.sql"
DB_TMP_FILE="${db_file}.tmp"
GLOBALS_TMP_FILE="${globals_file}.tmp"
trap cleanup EXIT

[[ ! -e "$db_file" ]] || fail "refusing to overwrite existing backup file: $db_file"
[[ ! -e "$DB_TMP_FILE" ]] || fail "temporary backup file already exists: $DB_TMP_FILE"
if [[ "$SKIP_GLOBALS" -eq 0 ]]; then
  [[ ! -e "$globals_file" ]] || fail "refusing to overwrite existing globals backup file: $globals_file"
  [[ ! -e "$GLOBALS_TMP_FILE" ]] || fail "temporary globals backup file already exists: $GLOBALS_TMP_FILE"
fi

podman exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DB_TMP_FILE"
chmod 600 "$DB_TMP_FILE"
mv -- "$DB_TMP_FILE" "$db_file"
DB_TMP_FILE=""
printf 'OK: db backup created: %s\n' "$db_file"

if [[ "$SKIP_GLOBALS" -eq 0 ]]; then
  podman exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    pg_dumpall --globals-only -U "$POSTGRES_USER" > "$GLOBALS_TMP_FILE"
  chmod 600 "$GLOBALS_TMP_FILE"
  mv -- "$GLOBALS_TMP_FILE" "$globals_file"
  GLOBALS_TMP_FILE=""
  printf 'OK: globals backup created: %s\n' "$globals_file"
fi

trap - EXIT
cleanup

if [[ "$PRINT_PREFIX" -eq 1 ]]; then
  printf '%s\n' "$prefix"
fi
