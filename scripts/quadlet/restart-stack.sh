#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STOP_STACK="${STOP_STACK:-$ROOT_DIR/scripts/quadlet/stop-stack.sh}"
START_STACK="${START_STACK:-$ROOT_DIR/scripts/quadlet/start-stack.sh}"
SKIP_ENV_CHECK=0
SKIP_STACK_CHECK=0
INCLUDE_PROXY=0
PROFILE="${SAKURA_VPS_PROFILE:-production}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --skip-env-check        Pass through to start-stack.sh
  --skip-build-env-check  Deprecated alias for --skip-env-check
  --skip-stack-check      Pass through to start-stack.sh; also skip post-restart status verification
  --profile NAME          Pass production, private-smoke, or https-trial to start-stack.sh
  --include-proxy         Stop/start erp4-caddy.service and verify proxy status
  -h, --help              Show this help message and exit
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
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
    --profile)
      [[ $# -ge 2 ]] || fail 'missing argument for --profile'
      PROFILE="$2"
      shift 2
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

case "$PROFILE" in
  production|private-smoke|https-trial) ;;
  *) fail "unknown profile: $PROFILE" ;;
esac
if [[ "$PROFILE" == "private-smoke" && "$INCLUDE_PROXY" -eq 1 ]]; then
  fail 'private-smoke must not include proxy'
fi
if [[ "$PROFILE" == "https-trial" && "$INCLUDE_PROXY" -eq 0 ]]; then
  fail 'https-trial requires --include-proxy'
fi

[[ -x "$STOP_STACK" ]] || fail "stop stack script is not executable: $STOP_STACK"
[[ -x "$START_STACK" ]] || fail "start stack script is not executable: $START_STACK"

stop_args=()
start_args=()
start_args+=(--profile "$PROFILE")
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  stop_args+=(--include-proxy)
  start_args+=(--include-proxy)
fi
if [[ "$SKIP_ENV_CHECK" -eq 1 ]]; then
  start_args+=(--skip-env-check)
fi
if [[ "$SKIP_STACK_CHECK" -eq 1 ]]; then
  start_args+=(--skip-stack-check)
fi

"$STOP_STACK" "${stop_args[@]}"
"$START_STACK" "${start_args[@]}"

printf 'OK: Quadlet stack restarted\n'
