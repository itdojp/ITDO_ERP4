#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STOP_STACK="${STOP_STACK:-$ROOT_DIR/scripts/quadlet/stop-stack.sh}"
START_STACK="${START_STACK:-$ROOT_DIR/scripts/quadlet/start-stack.sh}"
SKIP_ENV_CHECK=0
SKIP_STACK_CHECK=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --skip-env-check        Pass through to start-stack.sh
  --skip-build-env-check  Deprecated alias for --skip-env-check
  --skip-stack-check      Pass through to start-stack.sh
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

start_args=()
if [[ "$SKIP_ENV_CHECK" -eq 1 ]]; then
  start_args+=(--skip-env-check)
fi
if [[ "$SKIP_STACK_CHECK" -eq 1 ]]; then
  start_args+=(--skip-stack-check)
fi

"$STOP_STACK"
"$START_STACK" "${start_args[@]}"

printf 'OK: Quadlet stack restarted\n'
