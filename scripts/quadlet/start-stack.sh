#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_ENV="$ROOT_DIR/scripts/quadlet/check-env.sh"
CHECK_STACK="$ROOT_DIR/scripts/quadlet/check-stack.sh"
STATUS_STACK="$ROOT_DIR/scripts/quadlet/status-stack.sh"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
SKIP_ENV_CHECK=0
SKIP_STACK_CHECK=0
INCLUDE_PROXY=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --skip-env-check        Skip environment validation performed by check-env.sh
  --skip-build-env-check  Deprecated alias for --skip-env-check
  --skip-stack-check      Skip post-start validation performed by check-stack.sh
  --include-proxy         Enable/start erp4-caddy.service and verify proxy status
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
    --skip-env-check|--skip-build-env-check)
      SKIP_ENV_CHECK=1
      shift
      ;;
    --skip-stack-check)
      SKIP_STACK_CHECK=1
      shift
      ;;
    --include-proxy)
      INCLUDE_PROXY=1
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
if [[ "$INCLUDE_PROXY" -eq 1 && "$SKIP_STACK_CHECK" -eq 0 ]]; then
  [[ -x "$STATUS_STACK" ]] || fail "status stack script is not executable: $STATUS_STACK"
fi

if [[ "$SKIP_ENV_CHECK" -eq 0 ]]; then
  "$CHECK_ENV" --target-dir "$TARGET_DIR"
fi

run_systemctl_user daemon-reload
run_systemctl_user enable --now \
  erp4-postgres.service \
  erp4-migrate.service \
  erp4-backend.service \
  erp4-frontend.service

if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  run_systemctl_user enable --now erp4-caddy.service
fi

if [[ "$SKIP_STACK_CHECK" -eq 0 ]]; then
  "$CHECK_STACK"
  if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
    "$STATUS_STACK" --include-proxy
  fi
fi

printf 'OK: Quadlet stack started from %s\n' "$TARGET_DIR"
