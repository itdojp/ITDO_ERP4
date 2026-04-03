#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_PROXY="${CHECK_PROXY:-$ROOT_DIR/scripts/quadlet/check-proxy.sh}"
STATUS_STACK="${STATUS_STACK:-$ROOT_DIR/scripts/quadlet/status-stack.sh}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
CADDY_ENV="${CADDY_ENV_FILE:-$TARGET_DIR/erp4-caddy.env}"
CADDYFILE="${CADDYFILE_PATH:-$TARGET_DIR/erp4-caddy.Caddyfile}"
SKIP_PROXY_CHECK=0
SKIP_RUNTIME=0
SKIP_STATUS=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help          Show this help message and exit
  --target-dir DIR    Set the target directory for generated quadlet files
  --caddy-env FILE    Path to the Caddy environment file
  --caddyfile FILE    Path to the Caddyfile configuration
  --skip-proxy-check  Skip config validation performed by check-proxy.sh
  --skip-runtime      Forward --skip-runtime to check-proxy.sh
  --skip-status       Skip post-reload validation performed by status-stack.sh --include-proxy
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_systemctl_user() {
  local output
  if output="$("$SYSTEMCTL" --user "$@" 2>&1)"; then
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
      [[ $# -ge 2 ]] || fail 'missing argument for --target-dir'
      TARGET_DIR="$2"
      CADDY_ENV="$TARGET_DIR/erp4-caddy.env"
      CADDYFILE="$TARGET_DIR/erp4-caddy.Caddyfile"
      shift 2
      ;;
    --caddy-env)
      [[ $# -ge 2 ]] || fail 'missing argument for --caddy-env'
      CADDY_ENV="$2"
      shift 2
      ;;
    --caddyfile)
      [[ $# -ge 2 ]] || fail 'missing argument for --caddyfile'
      CADDYFILE="$2"
      shift 2
      ;;
    --skip-proxy-check)
      SKIP_PROXY_CHECK=1
      shift
      ;;
    --skip-status)
      SKIP_STATUS=1
      shift
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

command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"

if [[ "$SKIP_PROXY_CHECK" -eq 0 ]]; then
  [[ -x "$CHECK_PROXY" ]] || fail "required executable not found: $CHECK_PROXY"
  check_proxy_args=(--caddy-env "$CADDY_ENV" --caddyfile "$CADDYFILE")
  if [[ "$SKIP_RUNTIME" -eq 1 ]]; then
    check_proxy_args+=(--skip-runtime)
  fi
  "$CHECK_PROXY" "${check_proxy_args[@]}"
fi

run_systemctl_user restart erp4-caddy.service

if [[ "$SKIP_STATUS" -eq 0 ]]; then
  [[ -x "$STATUS_STACK" ]] || fail "required executable not found: $STATUS_STACK"
  "$STATUS_STACK" --include-proxy
fi

printf 'OK: Caddy proxy reloaded from %s\n' "$TARGET_DIR"
