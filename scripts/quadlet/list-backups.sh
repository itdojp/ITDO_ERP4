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

mapfile -t sorted < <(
  for archive in "${archives[@]}"; do
    printf '%s\t%s\n' "$(stat -c %Y "$archive")" "$archive"
  done | sort -rn | cut -f2-
)

if [[ "$LATEST_ONLY" -eq 1 ]]; then
  printf '%s\n' "${sorted[0]}"
  exit 0
fi

count=0
for archive in "${sorted[@]}"; do
  if [[ -n "$LIMIT" && "$count" -ge "$LIMIT" ]]; then
    break
  fi
  size="$(stat -c %s "$archive")"
  mtime_epoch="$(stat -c %Y "$archive")"
  mtime="$(date -d "@$mtime_epoch" '+%Y-%m-%d %H:%M:%S %z')"
  printf '%s\t%s\t%s\n' "$mtime" "$size" "$archive"
  count=$((count + 1))
done
