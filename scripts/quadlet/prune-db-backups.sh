#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${QUADLET_DB_BACKUP_DIR:-$HOME/.local/share/erp4/db-backups}"
KEEP_COUNT=""
KEEP_DAYS=""
DRY_RUN=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help          Show this help message and exit
  --backup-dir DIR    Directory that contains DB backup artifacts
  --keep-count N      Keep the newest N DB dumps
  --keep-days N       Keep DB dumps whose mtime is within the last N days
  --dry-run           Show DB dumps that would be removed without deleting them

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
backups=("$BACKUP_DIR"/erp4-postgres-*.dump)
shopt -u nullglob
if [[ ${#backups[@]} -eq 0 ]]; then
  printf 'OK: no db backup dumps found in %s\n' "$BACKUP_DIR"
  exit 0
fi

metadata_lines=()
for dump in "${backups[@]}"; do
  if ! stat_output="$(stat -c '%Y	%n' "$dump")"; then
    fail "failed to read backup metadata: $dump"
  fi
  metadata_lines+=("$stat_output")
done
mapfile -t backups < <(printf '%s\n' "${metadata_lines[@]}" | sort -n | cut -f2-)

declare -A keep=()
if [[ -n "$KEEP_COUNT" ]]; then
  total=${#backups[@]}
  start=$(( total > KEEP_COUNT ? total - KEEP_COUNT : 0 ))
  for ((i = start; i < total; i++)); do
    keep["${backups[$i]}"]=1
  done
fi

if [[ -n "$KEEP_DAYS" ]]; then
  cutoff=$(( $(date +%s) - KEEP_DAYS * 86400 ))
  for dump in "${backups[@]}"; do
    mtime="$(stat -c %Y "$dump")"
    if (( mtime >= cutoff )); then
      keep["$dump"]=1
    fi
  done
fi

to_delete=()
for dump in "${backups[@]}"; do
  if [[ -z "${keep[$dump]:-}" ]]; then
    to_delete+=("$dump")
  fi
done

if [[ ${#to_delete[@]} -eq 0 ]]; then
  printf 'OK: no db backup dumps matched the prune criteria in %s\n' "$BACKUP_DIR"
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'Would delete:\n'
else
  printf 'Deleted:\n'
fi
for dump in "${to_delete[@]}"; do
  globals_file="${dump%.dump}-globals.sql"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '  %s\n' "$dump"
    if [[ -f "$globals_file" ]]; then
      printf '  %s\n' "$globals_file"
    fi
    continue
  fi

  rm -f -- "$dump"
  printf '  %s\n' "$dump"
  if [[ -f "$globals_file" ]]; then
    rm -f -- "$globals_file"
    printf '  %s\n' "$globals_file"
  fi
done
