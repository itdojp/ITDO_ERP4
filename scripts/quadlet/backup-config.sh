#!/usr/bin/env bash
set -euo pipefail

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
umask 077
mkdir -p -m 700 "$OUTPUT_DIR"

files=(
  erp4-postgres.env
  erp4-backend.env
  erp4-frontend-build.env
  erp4-maintenance.env
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
  if [[ -f "$TARGET_DIR/$name" ]]; then
    staged+=("$name")
  fi
done

[[ ${#staged[@]} -gt 0 ]] || fail "no matching files found in $TARGET_DIR"

archive="$OUTPUT_DIR/erp4-quadlet-config-$STAMP.tar.gz"
tar -C "$TARGET_DIR" -czf "$archive" "${staged[@]}"
chmod 600 "$archive"

if [[ "$PRINT_ARCHIVE" -eq 1 ]]; then
  printf '%s\n' "$archive"
  exit 0
fi

printf 'OK: backup written to %s\n' "$archive"
printf 'Included files:\n'
printf '  %s\n' "${staged[@]}"
