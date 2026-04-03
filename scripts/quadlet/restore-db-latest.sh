#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RESTORE_DB="${RESTORE_DB:-$SCRIPT_DIR/restore-db.sh}"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
ENV_FILE="${POSTGRES_ENV_FILE:-$TARGET_DIR/erp4-postgres.env}"
ENV_FILE_EXPLICIT=0
BACKUP_DIR="${QUADLET_DB_BACKUP_DIR:-$HOME/.local/share/erp4/db-backups}"
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-erp4-postgres}"
SKIP_GLOBALS=0
CLEAN_PUBLIC_SCHEMA=0
PRINT_PREFIX=0

usage() {
  cat <<USAGE
Usage: RESTORE_CONFIRM=1 $(basename "$0") [options]
  -h, --help             Show this help message and exit
  --target-dir DIR       Quadlet config directory (default: ~/.config/containers/systemd)
  --env-file PATH        PostgreSQL env file path (default: <target-dir>/erp4-postgres.env)
  --backup-dir DIR       Directory containing db backups (default: ~/.local/share/erp4/db-backups)
  --container NAME       PostgreSQL container name (default: erp4-postgres)
  --skip-globals         Skip globals restore even if latest globals file exists
  --clean-public-schema  Drop and recreate public schema before restore
  --print-prefix         Print selected latest backup prefix and exit without restore
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
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
    --skip-globals)
      SKIP_GLOBALS=1
      shift
      ;;
    --clean-public-schema)
      CLEAN_PUBLIC_SCHEMA=1
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

command -v "$RESTORE_DB" >/dev/null 2>&1 || [[ -x "$RESTORE_DB" ]] || fail "required helper not found: $RESTORE_DB"
[[ -d "$BACKUP_DIR" ]] || fail "backup directory not found: $BACKUP_DIR"

latest_db_file="$({ find "$BACKUP_DIR" -maxdepth 1 -type f -name 'erp4-postgres-*.dump' -printf '%T@ %p\n' 2>/dev/null || true; } | sort -nr | head -n1 | cut -d' ' -f2-)"
[[ -n "$latest_db_file" ]] || fail "no database backup found in $BACKUP_DIR"
latest_prefix="${latest_db_file%.dump}"
latest_globals_file="${latest_prefix}-globals.sql"

if [[ "$PRINT_PREFIX" -eq 1 ]]; then
  printf '%s\n' "$latest_prefix"
  exit 0
fi

restore_args=(--env-file "$ENV_FILE" --container "$CONTAINER_NAME" --db-file "$latest_db_file")
if [[ "$SKIP_GLOBALS" -eq 0 ]]; then
  [[ -f "$latest_globals_file" ]] || fail "globals backup file not found for latest backup: $latest_globals_file"
  restore_args+=(--globals-file "$latest_globals_file")
else
  restore_args+=(--skip-globals)
fi
if [[ "$CLEAN_PUBLIC_SCHEMA" -eq 1 ]]; then
  restore_args+=(--clean-public-schema)
fi

"$RESTORE_DB" "${restore_args[@]}"
