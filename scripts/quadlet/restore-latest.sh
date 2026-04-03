#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${QUADLET_BACKUP_DIR:-$HOME/.local/share/erp4/quadlet-backups}"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
OVERWRITE=0
LIST_ONLY=0
SKIP_DAEMON_RELOAD=0
PRINT_ARCHIVE=0
LIST_BACKUPS_SCRIPT="${LIST_BACKUPS_SCRIPT:-$SCRIPT_DIR/list-backups.sh}"
RESTORE_CONFIG_SCRIPT="${RESTORE_CONFIG_SCRIPT:-$SCRIPT_DIR/restore-config.sh}"
BASH_BIN="${BASH:-/bin/bash}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help             Show this help message and exit
  --backup-dir DIR       Directory that contains backup archives
  --target-dir DIR       Restore target directory (default: ~/.config/containers/systemd)
  --overwrite            Allow restoring over existing files
  --list                 List entries from the latest archive and exit
  --skip-daemon-reload   Skip systemctl --user daemon-reload after restoring unit files
  --print-archive        Print the selected archive path before restore/list
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --backup-dir'
      BACKUP_DIR="$2"
      shift 2
      ;;
    --target-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --target-dir'
      TARGET_DIR="$2"
      shift 2
      ;;
    --overwrite)
      OVERWRITE=1
      shift
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    --skip-daemon-reload)
      SKIP_DAEMON_RELOAD=1
      shift
      ;;
    --print-archive)
      PRINT_ARCHIVE=1
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
[[ -f "$LIST_BACKUPS_SCRIPT" ]] || fail "helper script not found: $LIST_BACKUPS_SCRIPT"
[[ -f "$RESTORE_CONFIG_SCRIPT" ]] || fail "helper script not found: $RESTORE_CONFIG_SCRIPT"

if ! latest_archive="$("$BASH_BIN" "$LIST_BACKUPS_SCRIPT" --backup-dir "$BACKUP_DIR" --latest)"; then
  fail "could not determine latest backup archive from $BACKUP_DIR"
fi
[[ -n "$latest_archive" ]] || fail "latest backup archive path is empty: $BACKUP_DIR"

if [[ "$PRINT_ARCHIVE" -eq 1 ]]; then
  printf 'Selected archive: %s\n' "$latest_archive"
fi

restore_args=(
  --archive "$latest_archive"
  --target-dir "$TARGET_DIR"
)

if [[ "$OVERWRITE" -eq 1 ]]; then
  restore_args+=(--overwrite)
fi
if [[ "$LIST_ONLY" -eq 1 ]]; then
  restore_args+=(--list)
fi
if [[ "$SKIP_DAEMON_RELOAD" -eq 1 ]]; then
  restore_args+=(--skip-daemon-reload)
fi

exec "$BASH_BIN" "$RESTORE_CONFIG_SCRIPT" "${restore_args[@]}"
