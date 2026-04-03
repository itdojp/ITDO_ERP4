#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${QUADLET_BACKUP_DIR:-$HOME/.local/share/erp4/quadlet-backups}"
LATEST_ONLY=0
LIMIT=""

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help         Show this help message and exit
  --backup-dir DIR   Directory that contains backup archives
  --latest           Print only the latest archive path
  --limit N          Show only the newest N archives
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

if [[ -n "$LIMIT" ]] && ! is_non_negative_integer "$LIMIT"; then
  fail "--limit must be a non-negative integer: $LIMIT"
fi

shopt -s nullglob
archives=("$BACKUP_DIR"/erp4-quadlet-config-*.tar.gz)
shopt -u nullglob
[[ ${#archives[@]} -gt 0 ]] || fail "no backup archives found in $BACKUP_DIR"

metadata_lines=()
for archive in "${archives[@]}"; do
  if ! stat_output="$(stat -c '%Y	%s	%y	%n' "$archive")"; then
    fail "failed to read archive metadata: $archive"
  fi
  metadata_lines+=("$stat_output")
done

mapfile -t sorted < <(printf '%s\n' "${metadata_lines[@]}" | sort -rn -k1,1)

if [[ "$LATEST_ONLY" -eq 1 ]]; then
  IFS=$'\t' read -r _ _ _ latest_path <<<"${sorted[0]}"
  printf '%s\n' "$latest_path"
  exit 0
fi

count=0
for line in "${sorted[@]}"; do
  if [[ -n "$LIMIT" && "$count" -ge "$LIMIT" ]]; then
    break
  fi
  IFS=$'\t' read -r _ size raw_mtime archive <<<"$line"
  mtime="${raw_mtime:0:19} ${raw_mtime: -5}"
  printf '%s\t%s\t%s\n' "$mtime" "$size" "$archive"
  count=$((count + 1))
done
