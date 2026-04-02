#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STOP_STACK="${STOP_STACK:-$ROOT_DIR/scripts/quadlet/stop-stack.sh}"
START_STACK="${START_STACK:-$ROOT_DIR/scripts/quadlet/start-stack.sh}"
STATUS_STACK="${STATUS_STACK:-$ROOT_DIR/scripts/quadlet/status-stack.sh}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
SKIP_ENV_CHECK=0
SKIP_STACK_CHECK=0
INCLUDE_PROXY=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --skip-env-check        Pass through to start-stack.sh
  --skip-build-env-check  Deprecated alias for --skip-env-check
  --skip-stack-check      Pass through to start-stack.sh
  --include-proxy         Stop/start erp4-caddy.service and verify proxy status
  -h, --help              Show this help message and exit
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_systemctl_user() {
  local output

  if output="$("$SYSTEMCTL" --user "$@" 2>&1)"; then
    [[ -n "$output" ]] && printf '%s\n' "$output"
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

[[ -x "$STOP_STACK" ]] || fail "stop stack script is not executable: $STOP_STACK"
[[ -x "$START_STACK" ]] || fail "start stack script is not executable: $START_STACK"
if [[ "$INCLUDE_PROXY" -eq 1 && "$SKIP_STACK_CHECK" -eq 0 ]]; then
  [[ -x "$STATUS_STACK" ]] || fail "status stack script is not executable: $STATUS_STACK"
fi
command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"

stop_args=()
start_args=()
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  stop_args+=(--include-proxy)
fi
if [[ "$SKIP_ENV_CHECK" -eq 1 ]]; then
  start_args+=(--skip-env-check)
fi
if [[ "$SKIP_STACK_CHECK" -eq 1 ]]; then
  start_args+=(--skip-stack-check)
fi

"$STOP_STACK" "${stop_args[@]}"
"$START_STACK" "${start_args[@]}"

if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  run_systemctl_user enable --now erp4-caddy.service
  if [[ "$SKIP_STACK_CHECK" -eq 0 ]]; then
    "$STATUS_STACK" --include-proxy
  fi
fi

printf 'OK: Quadlet stack restarted\n'
