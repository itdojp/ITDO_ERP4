#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${QUADLET_BACKUP_DIR:-$HOME/.local/share/erp4/quadlet-backups}"
KEEP_COUNT=""
KEEP_DAYS=""
DRY_RUN=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help          Show this help message and exit
  --backup-dir DIR    Directory that contains backup archives
  --keep-count N      Keep the newest N archives
  --keep-days N       Keep archives whose mtime is within the last N days
  --dry-run           Show archives that would be removed without deleting them

At least one of --keep-count or --keep-days is required.
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
    --keep-count)
      [[ $# -ge 2 ]] || fail 'missing argument for --keep-count'
      KEEP_COUNT="$2"
      shift 2
      ;;
    --keep-days)
      [[ $# -ge 2 ]] || fail 'missing argument for --keep-days'
      KEEP_DAYS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
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

[[ -n "$KEEP_COUNT" || -n "$KEEP_DAYS" ]] || fail 'at least one of --keep-count or --keep-days is required'
[[ -d "$BACKUP_DIR" ]] || fail "backup directory not found: $BACKUP_DIR"
command -v date >/dev/null 2>&1 || fail 'required command not found: date'
command -v stat >/dev/null 2>&1 || fail 'required command not found: stat'

if [[ -n "$KEEP_COUNT" ]] && ! is_non_negative_integer "$KEEP_COUNT"; then
  fail "--keep-count must be a non-negative integer: $KEEP_COUNT"
fi
if [[ -n "$KEEP_DAYS" ]] && ! is_non_negative_integer "$KEEP_DAYS"; then
  fail "--keep-days must be a non-negative integer: $KEEP_DAYS"
fi

shopt -s nullglob
archives=("$BACKUP_DIR"/erp4-quadlet-config-*.tar.gz)
shopt -u nullglob
[[ ${#archives[@]} -gt 0 ]] || fail "no backup archives found in $BACKUP_DIR"

mapfile -t archives < <(printf '%s\n' "${archives[@]}" | sort)
declare -A keep=()

if [[ -n "$KEEP_COUNT" ]]; then
  total=${#archives[@]}
  start=$(( total > KEEP_COUNT ? total - KEEP_COUNT : 0 ))
  for ((i = start; i < total; i++)); do
    keep["${archives[$i]}"]=1
  done
fi

if [[ -n "$KEEP_DAYS" ]]; then
  cutoff=$(( $(date +%s) - KEEP_DAYS * 86400 ))
  for archive in "${archives[@]}"; do
    mtime="$(stat -c %Y "$archive")"
    if (( mtime >= cutoff )); then
      keep["$archive"]=1
    fi
  done
fi

to_delete=()
for archive in "${archives[@]}"; do
  if [[ -z "${keep[$archive]:-}" ]]; then
    to_delete+=("$archive")
  fi
done

if [[ ${#to_delete[@]} -eq 0 ]]; then
  printf 'OK: no backup archives matched the prune criteria in %s\n' "$BACKUP_DIR"
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'Would delete:\n'
else
  printf 'Deleted:\n'
fi
for archive in "${to_delete[@]}"; do
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  %s\n' "$archive"
  else
    rm -f -- "$archive"
    printf '  %s\n' "$archive"
  fi
done
