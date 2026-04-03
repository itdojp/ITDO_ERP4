#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${QUADLET_DB_BACKUP_DIR:-$HOME/.local/share/erp4/db-backups}"
MAX_AGE_HOURS=""
REQUIRE_GLOBALS=1
PRINT_PREFIX=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help           Show this help message and exit
  --backup-dir DIR     Directory that contains DB backup artifacts
  --max-age-hours N    Fail if the latest DB dump is older than N hours
  --skip-globals       Do not require a matching globals dump for the latest DB dump
  --print-prefix       Print the latest backup prefix after successful validation
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

is_non_negative_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --backup-dir'
      BACKUP_DIR="$2"
      shift 2
      ;;
    --max-age-hours)
      [[ $# -ge 2 ]] || fail 'missing argument for --max-age-hours'
      MAX_AGE_HOURS="$2"
      shift 2
      ;;
    --skip-globals)
      REQUIRE_GLOBALS=0
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

[[ -d "$BACKUP_DIR" ]] || fail "backup directory not found: $BACKUP_DIR"
command -v date >/dev/null 2>&1 || fail 'required command not found: date'
command -v stat >/dev/null 2>&1 || fail 'required command not found: stat'

if [[ -n "$MAX_AGE_HOURS" ]] && ! is_non_negative_integer "$MAX_AGE_HOURS"; then
  fail "--max-age-hours must be a non-negative integer: $MAX_AGE_HOURS"
fi
if [[ -n "$MAX_AGE_HOURS" ]]; then
  MAX_AGE_HOURS=$((10#$MAX_AGE_HOURS))
fi

shopt -s nullglob
backups=("$BACKUP_DIR"/erp4-postgres-*.dump)
shopt -u nullglob
[[ ${#backups[@]} -gt 0 ]] || fail "no db backup dumps found in $BACKUP_DIR"

metadata_lines=()
for dump in "${backups[@]}"; do
  if ! stat_output="$(stat -c '%Y	%n' "$dump")"; then
    fail "failed to read backup metadata: $dump"
  fi
  metadata_lines+=("$stat_output")
done
mapfile -t sorted < <(printf '%s\n' "${metadata_lines[@]}" | sort -rn -k1,1)
IFS=$'\t' read -r latest_mtime latest_dump <<<"${sorted[0]}"
latest_prefix="${latest_dump%.dump}"
latest_globals="${latest_prefix}-globals.sql"

if [[ "$REQUIRE_GLOBALS" -eq 1 && ! -f "$latest_globals" ]]; then
  fail "matching globals backup not found for latest dump: $latest_globals"
fi

if [[ -n "$MAX_AGE_HOURS" ]]; then
  now_epoch=$(date +%s)
  age_seconds=$(( now_epoch - latest_mtime ))
  max_age_seconds=$(( MAX_AGE_HOURS * 3600 ))
  if (( age_seconds > max_age_seconds )); then
    fail "latest db backup is older than ${MAX_AGE_HOURS}h: $latest_dump"
  fi
fi

printf 'OK: latest db backup: %s\n' "$latest_dump"
if [[ "$REQUIRE_GLOBALS" -eq 1 ]]; then
  printf 'OK: latest globals backup: %s\n' "$latest_globals"
fi
if [[ "$PRINT_PREFIX" -eq 1 ]]; then
  printf '%s\n' "$latest_prefix"
fi
