#!/usr/bin/env bash
set -euo pipefail

BACKUP_AND_CHECK="${BACKUP_AND_CHECK:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backup-and-check.sh}"
PRUNE_BACKUPS="${PRUNE_BACKUPS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prune-backups.sh}"
KEEP_COUNT="${ERP4_BACKUP_KEEP_COUNT:-14}"
KEEP_DAYS="${ERP4_BACKUP_KEEP_DAYS:-30}"
INCLUDE_PROXY=0
INCLUDE_UNITS=0
SKIP_BACKUP=0
SKIP_PRUNE=0
LIST_ARCHIVE=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help        Show this help message and exit
  --include-proxy   Include proxy config in the backup phase
  --include-units   Include Quadlet units in the backup phase
  --skip-backup     Skip backup-and-check and run prune only
  --skip-prune      Skip prune and run backup-and-check only
  --list            Pass --list to backup-and-check
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-proxy)
      INCLUDE_PROXY=1
      shift
      ;;
    --include-units)
      INCLUDE_UNITS=1
      shift
      ;;
    --skip-backup)
      SKIP_BACKUP=1
      shift
      ;;
    --skip-prune)
      SKIP_PRUNE=1
      shift
      ;;
    --list)
      LIST_ARCHIVE=1
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

[[ -x "$BACKUP_AND_CHECK" ]] || fail "required executable not found: $BACKUP_AND_CHECK"
[[ -x "$PRUNE_BACKUPS" ]] || fail "required executable not found: $PRUNE_BACKUPS"
[[ "$SKIP_BACKUP" -eq 0 || "$SKIP_PRUNE" -eq 0 ]] || fail 'nothing to do: both backup and prune are skipped'

backup_args=()
[[ "$INCLUDE_PROXY" -eq 1 ]] && backup_args+=(--include-proxy)
[[ "$INCLUDE_UNITS" -eq 1 ]] && backup_args+=(--include-units)
[[ "$LIST_ARCHIVE" -eq 1 ]] && backup_args+=(--list)

if [[ "$SKIP_BACKUP" -eq 0 ]]; then
  "$BACKUP_AND_CHECK" "${backup_args[@]}"
fi

if [[ "$SKIP_PRUNE" -eq 0 ]]; then
  "$PRUNE_BACKUPS" --keep-count "$KEEP_COUNT" --keep-days "$KEEP_DAYS"
fi
