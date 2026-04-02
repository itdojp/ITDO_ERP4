#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
CADDY_ENV="${CADDY_ENV_FILE:-$TARGET_DIR/erp4-caddy.env}"
CADDYFILE="${CADDYFILE_PATH:-$TARGET_DIR/erp4-caddy.Caddyfile}"
CADDY_IMAGE="${CADDY_IMAGE:-docker.io/library/caddy:2.9-alpine}"
CHECK_RUNTIME=1

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "required file not found: $1"
}

absolute_path() {
  local path="$1"
  local dir
  dir="$(cd "$(dirname "$path")" && pwd)"
  printf '%s/%s\n' "$dir" "$(basename "$path")"
}

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --target-dir DIR
  --caddy-env FILE
  --caddyfile FILE
  --skip-runtime
USAGE
}

read_env_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    $0 ~ /^[[:space:]]*#/ { next }
    $0 ~ /^[[:space:]]*$/ { next }
    {
      pos = index($0, "=")
      if (pos == 0) next
      k = substr($0, 1, pos - 1)
      sub(/^[[:space:]]+/, "", k)
      sub(/[[:space:]]+$/, "", k)
      if (k == key) {
        v = substr($0, pos + 1)
        sub(/^[[:space:]]+/, "", v)
        sub(/[[:space:]]+$/, "", v)
        gsub(/^"|"$/, "", v)
        print v
        exit
      }
    }
  ' "$file"
}

require_env_key() {
  local file="$1"
  local key="$2"
  local value
  value="$(read_env_value "$file" "$key")"
  [[ -n "$value" ]] || fail "$file is missing required key: $key"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      [[ $# -ge 2 ]] || fail "--target-dir requires a directory path argument"
      TARGET_DIR="$2"
      CADDY_ENV="$TARGET_DIR/erp4-caddy.env"
      CADDYFILE="$TARGET_DIR/erp4-caddy.Caddyfile"
      shift 2
      ;;
    --caddy-env)
      [[ $# -ge 2 ]] || fail "--caddy-env requires a file path argument"
      CADDY_ENV="$2"
      shift 2
      ;;
    --caddyfile)
      [[ $# -ge 2 ]] || fail "--caddyfile requires a file path argument"
      CADDYFILE="$2"
      shift 2
      ;;
    --skip-runtime)
      CHECK_RUNTIME=0
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

require_file "$CADDY_ENV"
require_file "$CADDYFILE"

CADDY_ENV="$(absolute_path "$CADDY_ENV")"
CADDYFILE="$(absolute_path "$CADDYFILE")"

require_env_key "$CADDY_ENV" APP_DOMAIN
require_env_key "$CADDY_ENV" API_DOMAIN
require_env_key "$CADDY_ENV" ACME_EMAIL

if [[ "$CHECK_RUNTIME" -eq 1 ]]; then
  command -v podman >/dev/null 2>&1 || fail "required command not found: podman"
  podman run --rm \
    --env-file "$CADDY_ENV" \
    -v "$CADDYFILE:/etc/caddy/Caddyfile:ro,Z" \
    "$CADDY_IMAGE" \
    caddy validate --config /etc/caddy/Caddyfile >/dev/null
fi

printf 'OK: Caddy proxy config is valid'
if [[ "$CHECK_RUNTIME" -eq 1 ]]; then
  printf ' (%s)' "$CADDYFILE"
fi
printf '\n'
