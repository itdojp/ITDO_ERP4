#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_IMAGES="${BUILD_IMAGES:-$SCRIPT_DIR/build-images.sh}"
CHECK_STACK="${CHECK_STACK:-$SCRIPT_DIR/check-stack.sh}"
STATUS_STACK="${STATUS_STACK:-$SCRIPT_DIR/status-stack.sh}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
SKIP_BUILD=0
SKIP_STACK_CHECK=0
INCLUDE_PROXY=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --skip-build
  --skip-stack-check
  --include-proxy
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
    fail "systemctl --user failed because the user bus is unavailable; rerun with a user session or run 'sudo loginctl enable-linger $(id -un)'"
  fi

  printf '%s\n' "$output" >&2
  return 1
}

run_build_images() {
  if [[ "$SKIP_BUILD" -eq 1 ]]; then
    return 0
  fi

  "$BUILD_IMAGES"
}

run_stack_check() {
  if [[ "$SKIP_STACK_CHECK" -eq 1 ]]; then
    return 0
  fi

  "$CHECK_STACK"

  if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
    "$STATUS_STACK" --include-proxy
  fi
}

restart_unit() {
  local unit="$1"
  run_systemctl_user restart "$unit"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
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

command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  [[ -x "$BUILD_IMAGES" ]] || fail "build command is not executable: $BUILD_IMAGES"
fi
if [[ "$SKIP_STACK_CHECK" -eq 0 ]]; then
  [[ -x "$CHECK_STACK" ]] || fail "check command is not executable: $CHECK_STACK"
fi
if [[ "$SKIP_STACK_CHECK" -eq 0 && "$INCLUDE_PROXY" -eq 1 ]]; then
  [[ -x "$STATUS_STACK" ]] || fail "status command is not executable: $STATUS_STACK"
fi

run_build_images

restart_unit erp4-migrate.service
restart_unit erp4-backend.service
restart_unit erp4-frontend.service
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  restart_unit erp4-caddy.service
fi

run_stack_check
