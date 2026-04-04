#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
ENV_FILE="${POSTGRES_ENV_FILE:-$TARGET_DIR/erp4-postgres.env}"
BACKUP_DIR="${QUADLET_DB_BACKUP_DIR:-$HOME/.local/share/erp4/db-backups}"
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-erp4-postgres}"
TIMESTAMP="${BACKUP_TIMESTAMP:-}"
SKIP_GLOBALS=0
MAX_AGE_HOURS=""
PRINT_PREFIX=0
BACKUP_DB_SCRIPT="${BACKUP_DB_SCRIPT:-$SCRIPT_DIR/backup-db.sh}"
CHECK_DB_BACKUP_SCRIPT="${CHECK_DB_BACKUP_SCRIPT:-$SCRIPT_DIR/check-db-backup.sh}"
BASH_BIN="${BASH:-/bin/bash}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help           Show this help message and exit
  --target-dir DIR     Quadlet config directory (default: ~/.config/containers/systemd)
  --env-file PATH      PostgreSQL env file path (default: <target-dir>/erp4-postgres.env)
  --backup-dir DIR     Output directory for dump files
  --container NAME     PostgreSQL container name (default: erp4-postgres)
  --timestamp TS       Timestamp suffix to use instead of UTC now
  --skip-globals       Skip globals dump creation/check
  --max-age-hours N    Fail if the generated backup appears older than N hours
  --print-prefix       Print generated backup prefix after successful validation
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
      ENV_FILE="$TARGET_DIR/erp4-postgres.env"
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || fail 'missing argument for --env-file'
      ENV_FILE="$2"
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
    --max-age-hours)
      [[ $# -ge 2 ]] || fail 'missing argument for --max-age-hours'
      MAX_AGE_HOURS="$2"
      shift 2
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

[[ -x "$BASH_BIN" ]] || fail "bash interpreter not found or not executable: $BASH_BIN"
[[ -f "$BACKUP_DB_SCRIPT" ]] || fail "helper script not found: $BACKUP_DB_SCRIPT"
[[ -f "$CHECK_DB_BACKUP_SCRIPT" ]] || fail "helper script not found: $CHECK_DB_BACKUP_SCRIPT"

backup_args=(
  --env-file "$ENV_FILE"
  --backup-dir "$BACKUP_DIR"
  --container "$CONTAINER_NAME"
  --print-prefix
)
if [[ -n "$TIMESTAMP" ]]; then
  backup_args+=(--timestamp "$TIMESTAMP")
fi
if [[ "$SKIP_GLOBALS" -eq 1 ]]; then
  backup_args+=(--skip-globals)
fi

backup_output="$($BASH_BIN "$BACKUP_DB_SCRIPT" "${backup_args[@]}")"
backup_output="${backup_output%$'\n'}"
prefix="$(printf '%s\n' "$backup_output" | tail -n 1)"
info_lines="$(printf '%s\n' "$backup_output" | sed '$d')"
if [[ -n "$info_lines" ]]; then
  printf '%s\n' "$info_lines" >&2
fi
[[ -n "$prefix" ]] || fail 'backup helper did not return a backup prefix'
[[ -f "${prefix}.dump" ]] || fail "expected dump file was not created: ${prefix}.dump"
if [[ "$SKIP_GLOBALS" -eq 0 ]]; then
  [[ -f "${prefix}-globals.sql" ]] || fail "expected globals file was not created: ${prefix}-globals.sql"
fi

check_args=(--backup-dir "$(dirname "$prefix")")
if [[ -n "$MAX_AGE_HOURS" ]]; then
  check_args+=(--max-age-hours "$MAX_AGE_HOURS")
fi
if [[ "$SKIP_GLOBALS" -eq 1 ]]; then
  check_args+=(--skip-globals)
fi
if [[ "$PRINT_PREFIX" -eq 1 ]]; then
  check_args+=(--print-prefix)
fi

exec "$BASH_BIN" "$CHECK_DB_BACKUP_SCRIPT" "${check_args[@]}"
