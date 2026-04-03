#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${QUADLET_DB_BACKUP_DIR:-$HOME/.local/share/erp4/db-backups}"
LATEST_ONLY=0
LIMIT=""
PRINT_PREFIX=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help         Show this help message and exit
  --backup-dir DIR   Directory that contains DB backup artifacts
  --latest           Print only the latest DB dump path
  --limit N          Show only the newest N DB dumps
  --print-prefix     Print backup prefixes instead of dump paths
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
    --latest)
      LATEST_ONLY=1
      shift
      ;;
    --limit)
      [[ $# -ge 2 ]] || fail 'missing argument for --limit'
      LIMIT="$2"
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

[[ -d "$BACKUP_DIR" ]] || fail "backup directory not found: $BACKUP_DIR"
command -v stat >/dev/null 2>&1 || fail 'required command not found: stat'

if [[ -n "$LIMIT" ]] && ! is_non_negative_integer "$LIMIT"; then
  fail "--limit must be a non-negative integer: $LIMIT"
fi

shopt -s nullglob
backups=("$BACKUP_DIR"/erp4-postgres-*.dump)
shopt -u nullglob
[[ ${#backups[@]} -gt 0 ]] || fail "no db backup dumps found in $BACKUP_DIR"

metadata_lines=()
for dump in "${backups[@]}"; do
  if ! stat_output="$(stat -c '%Y	%s	%y	%n' "$dump")"; then
    fail "failed to read backup metadata: $dump"
  fi
  metadata_lines+=("$stat_output")
done

mapfile -t sorted < <(printf '%s\n' "${metadata_lines[@]}" | sort -rn -k1,1)

if [[ "$LATEST_ONLY" -eq 1 ]]; then
  IFS=$'\t' read -r _ _ _ latest_dump <<<"${sorted[0]}"
  if [[ "$PRINT_PREFIX" -eq 1 ]]; then
    printf '%s\n' "${latest_dump%.dump}"
  else
    printf '%s\n' "$latest_dump"
  fi
  exit 0
fi

count=0
for line in "${sorted[@]}"; do
  if [[ -n "$LIMIT" && "$count" -ge "$LIMIT" ]]; then
    break
  fi
  IFS=$'\t' read -r _ size raw_mtime dump <<<"$line"
  prefix="${dump%.dump}"
  globals_file="${prefix}-globals.sql"
  has_globals=no
  if [[ -f "$globals_file" ]]; then
    has_globals=yes
  fi
  mtime="${raw_mtime:0:19} ${raw_mtime: -5}"
  if [[ "$PRINT_PREFIX" -eq 1 ]]; then
    printf '%s\t%s\t%s\t%s\n' "$mtime" "$size" "$has_globals" "$prefix"
  else
    printf '%s\t%s\t%s\t%s\n' "$mtime" "$size" "$has_globals" "$dump"
  fi
  count=$((count + 1))
done
