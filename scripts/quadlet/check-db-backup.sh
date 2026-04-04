#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${QUADLET_DB_BACKUP_DIR:-$HOME/.local/share/erp4/db-backups}"
DUMP_FILE=""
MAX_AGE_HOURS=""
REQUIRE_GLOBALS=1
PRINT_PREFIX=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help           Show this help message and exit
  --backup-dir DIR     Directory that contains DB backup artifacts
  --dump-file PATH     Validate a specific DB dump file instead of selecting the latest one
  --max-age-hours N    Fail if the selected DB dump is older than N hours
  --skip-globals       Do not require a matching globals dump for the selected DB dump
  --print-prefix       Print the selected backup prefix after successful validation
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

is_non_negative_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

derive_globals_file() {
  local dump_file="$1"
  case "$dump_file" in
    *-db.dump)
      printf '%s-globals.sql\n' "${dump_file%-db.dump}"
      ;;
    *.dump)
      printf '%s-globals.sql\n' "${dump_file%.dump}"
      ;;
    *)
      return 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --backup-dir'
      BACKUP_DIR="$2"
      shift 2
      ;;
    --dump-file)
      [[ $# -ge 2 ]] || fail 'missing argument for --dump-file'
      DUMP_FILE="$2"
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

command -v date >/dev/null 2>&1 || fail 'required command not found: date'
command -v stat >/dev/null 2>&1 || fail 'required command not found: stat'

if [[ -n "$MAX_AGE_HOURS" ]] && ! is_non_negative_integer "$MAX_AGE_HOURS"; then
  fail "--max-age-hours must be a non-negative integer: $MAX_AGE_HOURS"
fi
if [[ -n "$MAX_AGE_HOURS" ]]; then
  MAX_AGE_HOURS=$((10#$MAX_AGE_HOURS))
fi

if [[ -n "$DUMP_FILE" ]]; then
  [[ -f "$DUMP_FILE" ]] || fail "db backup dump not found: $DUMP_FILE"
  selected_dump="$DUMP_FILE"
  BACKUP_DIR="$(dirname "$selected_dump")"
  if ! selected_mtime="$(stat -c '%Y' "$selected_dump")"; then
    fail "failed to read backup metadata: $selected_dump"
  fi
else
  [[ -d "$BACKUP_DIR" ]] || fail "backup directory not found: $BACKUP_DIR"
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
  IFS=$'\t' read -r selected_mtime selected_dump <<<"${sorted[0]}"
fi
selected_prefix="${selected_dump%.dump}"
selected_globals="$(derive_globals_file "$selected_dump")"

if [[ "$REQUIRE_GLOBALS" -eq 1 && ! -f "$selected_globals" ]]; then
  fail "matching globals backup not found for selected dump: $selected_globals"
fi

if [[ -n "$MAX_AGE_HOURS" ]]; then
  now_epoch=$(date +%s)
  if (( selected_mtime > now_epoch )); then
    fail "selected db backup mtime is in the future: $selected_dump"
  fi
  age_seconds=$(( now_epoch - selected_mtime ))
  max_age_seconds=$(( MAX_AGE_HOURS * 3600 ))
  if (( age_seconds > max_age_seconds )); then
    fail "selected db backup is older than ${MAX_AGE_HOURS}h: $selected_dump"
  fi
fi

if [[ "$PRINT_PREFIX" -eq 1 ]]; then
  printf 'OK: selected db backup: %s\n' "$selected_dump" >&2
  if [[ "$REQUIRE_GLOBALS" -eq 1 ]]; then
    printf 'OK: selected globals backup: %s\n' "$selected_globals" >&2
  fi
  printf '%s\n' "$selected_prefix"
  exit 0
fi

printf 'OK: selected db backup: %s\n' "$selected_dump"
if [[ "$REQUIRE_GLOBALS" -eq 1 ]]; then
  printf 'OK: selected globals backup: %s\n' "$selected_globals"
fi
