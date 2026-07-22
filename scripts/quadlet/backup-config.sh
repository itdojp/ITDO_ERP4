#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANAGED_UNIT_SOURCE_DIR="$ROOT_DIR/deploy/quadlet"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
OUTPUT_DIR="${QUADLET_BACKUP_DIR:-$HOME/.local/share/erp4/quadlet-backups}"
STAMP="${STAMP_OVERRIDE:-$(date +%Y%m%d-%H%M%S)}"
INCLUDE_PROXY=0
INCLUDE_UNITS=0
PRINT_ARCHIVE=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help           Show this help message and exit
  --target-dir DIR     Directory that contains Quadlet env/config files
  --output-dir DIR     Directory to write the backup archive into
  --include-proxy      Include caddy env/Caddyfile in the backup set
  --include-units      Include Quadlet unit definitions as well
  --print-archive      Print only the generated archive path
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

[[ -d "$TARGET_DIR" ]] || fail "target directory not found: $TARGET_DIR"
command -v tar >/dev/null 2>&1 || fail 'required command not found: tar'
command -v realpath >/dev/null 2>&1 || fail 'required command not found: realpath'
umask 077
mkdir -p -m 700 "$OUTPUT_DIR"

files=(
  erp4-postgres.env
  erp4-backend.env
  erp4-frontend-build.env
  erp4-maintenance.env
  erp4-storage-readiness.env
)

if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  files+=(erp4-caddy.env erp4-caddy.Caddyfile)
fi

if [[ "$INCLUDE_UNITS" -eq 1 ]]; then
  files+=(
    erp4.network
    erp4-postgres.volume
    erp4-backend-data.volume
    erp4-postgres.container
    erp4-migrate.service
    erp4-backend.container
    erp4-frontend.container
    erp4-config-backup.service
    erp4-config-backup.timer
    erp4-db-backup.service
    erp4-db-backup.timer
    erp4-config-prune.service
    erp4-config-prune.timer
    erp4-storage-readiness.service
    erp4-storage-readiness.timer
  )
  if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
    files+=(
      erp4-caddy-data.volume
      erp4-caddy-config.volume
      erp4-caddy.container
    )
  fi
fi

staged=()
for name in "${files[@]}"; do
  path="$TARGET_DIR/$name"
  if [[ -L "$path" && ! -f "$path" ]]; then
    fail "backup source is a broken symlink: $path"
  fi
  if [[ -L "$path" ]]; then
    case "$name" in
      *.container|*.service|*.timer|*.volume|*.network) ;;
      *) fail "env/config backup source must not be a symlink: $path" ;;
    esac
    resolved="$(realpath "$path")"
    case "$resolved" in
      "$MANAGED_UNIT_SOURCE_DIR"/*) ;;
      *) fail "unit symlink points outside the managed source directory: $path -> $resolved" ;;
    esac
  fi
  if [[ -f "$path" ]]; then
    staged+=("$name")
  fi
done

[[ ${#staged[@]} -gt 0 ]] || fail "no matching files found in $TARGET_DIR"

archive="$OUTPUT_DIR/erp4-quadlet-config-$STAMP.tar.gz"
# Default link-mode installs point unit files back to deploy/quadlet. Archive
# those validated managed links as regular files so restore/check never depend
# on the original repository path.
tar --dereference -C "$TARGET_DIR" -czf "$archive" "${staged[@]}"
chmod 600 "$archive"

if [[ "$PRINT_ARCHIVE" -eq 1 ]]; then
  printf '%s\n' "$archive"
  exit 0
fi

printf 'OK: backup written to %s\n' "$archive"
printf 'Included files:\n'
printf '  %s\n' "${staged[@]}"
