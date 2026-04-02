#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_PROXY="$ROOT_DIR/scripts/quadlet/check-proxy.sh"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
CADDY_ENV="$TARGET_DIR/erp4-caddy.env"
CADDYFILE="$TARGET_DIR/erp4-caddy.Caddyfile"
SKIP_RUNTIME=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --target-dir DIR   Set the target directory for generated quadlet files
  --caddy-env FILE   Path to the Caddy environment file
  --caddyfile FILE   Path to the Caddyfile configuration
  --skip-runtime     Skip runtime validation performed by check-proxy.sh
  -h, --help         Show this help message and exit
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_systemctl_user() {
  local output

  if output="$(systemctl --user "$@" 2>&1)"; then
    return 0
  fi

  if grep -Fq 'Failed to connect to bus' <<<"$output"; then
    fail "systemctl --user failed because the user bus is unavailable; log in with a user session or run 'sudo loginctl enable-linger $(id -un)'"
  fi

  printf '%s\n' "$output" >&2
  return 1
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
      SKIP_RUNTIME=1
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

command -v systemctl >/dev/null 2>&1 || fail 'required command not found: systemctl'
[[ -x "$CHECK_PROXY" ]] || fail "required file not executable: $CHECK_PROXY"
[[ -f "$CADDY_ENV" ]] || fail "required file not found: $CADDY_ENV"
[[ -f "$CADDYFILE" ]] || fail "required file not found: $CADDYFILE"

if [[ "$SKIP_RUNTIME" -eq 1 ]]; then
  "$CHECK_PROXY" --caddy-env "$CADDY_ENV" --caddyfile "$CADDYFILE" --skip-runtime
else
  "$CHECK_PROXY" --caddy-env "$CADDY_ENV" --caddyfile "$CADDYFILE"
fi

run_systemctl_user restart erp4-caddy.service

printf 'OK: Quadlet proxy reloaded from %s\n' "$TARGET_DIR"
