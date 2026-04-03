#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
OUTPUT_DIR="${QUADLET_BACKUP_DIR:-$HOME/.local/share/erp4/quadlet-backups}"
INCLUDE_PROXY=0
INCLUDE_UNITS=0
LIST_ENTRIES=0
PRINT_ARCHIVE=0
BACKUP_CONFIG_SCRIPT="${BACKUP_CONFIG_SCRIPT:-$SCRIPT_DIR/backup-config.sh}"
CHECK_BACKUP_SCRIPT="${CHECK_BACKUP_SCRIPT:-$SCRIPT_DIR/check-backup.sh}"
BASH_BIN="${BASH:-/bin/bash}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help          Show this help message and exit
  --target-dir DIR    Directory that contains Quadlet env/config files
  --output-dir DIR    Directory to write the backup archive into
  --include-proxy     Include caddy env/Caddyfile in the backup set
  --include-units     Include Quadlet unit definitions as well
  --list              Print archive entries after validation
  --print-archive     Print the generated archive path
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
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --output-dir'
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --include-proxy)
      INCLUDE_PROXY=1
      shift
      ;;
    --include-units)
      INCLUDE_UNITS=1
      shift
      ;;
    --list)
      LIST_ENTRIES=1
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
[[ -f "$BACKUP_CONFIG_SCRIPT" ]] || fail "helper script not found: $BACKUP_CONFIG_SCRIPT"
[[ -f "$CHECK_BACKUP_SCRIPT" ]] || fail "helper script not found: $CHECK_BACKUP_SCRIPT"

stamp="$(date +%Y%m%d-%H%M%S)"
archive="$OUTPUT_DIR/erp4-quadlet-config-$stamp.tar.gz"

backup_args=(
  --target-dir "$TARGET_DIR"
  --output-dir "$OUTPUT_DIR"
)
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  backup_args+=(--include-proxy)
fi
if [[ "$INCLUDE_UNITS" -eq 1 ]]; then
  backup_args+=(--include-units)
fi

STAMP_OVERRIDE="$stamp" "$BASH_BIN" "$BACKUP_CONFIG_SCRIPT" "${backup_args[@]}"
[[ -f "$archive" ]] || fail "expected backup archive was not created: $archive"

if [[ "$PRINT_ARCHIVE" -eq 1 ]]; then
  printf 'Generated archive: %s\n' "$archive"
fi

check_args=(--archive "$archive")
if [[ "$LIST_ENTRIES" -eq 1 ]]; then
  check_args+=(--list)
fi

exec "$BASH_BIN" "$CHECK_BACKUP_SCRIPT" "${check_args[@]}"
