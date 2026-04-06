#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
FRONTEND_BUILD_ENV="${FRONTEND_BUILD_ENV_FILE:-$ROOT_DIR/deploy/quadlet/env/erp4-frontend-build.env}"
CHECK_HOST="${CHECK_HOST:-$ROOT_DIR/scripts/quadlet/check-host-prereqs.sh}"
CHECK_ENV="${CHECK_ENV:-$ROOT_DIR/scripts/quadlet/check-env.sh}"
CHECK_STACK="${CHECK_STACK:-$ROOT_DIR/scripts/quadlet/check-stack.sh}"
CHECK_HTTPS="${CHECK_HTTPS:-$ROOT_DIR/scripts/quadlet/check-https.sh}"
INCLUDE_PROXY=0
RESOLVE_IP=""
INSECURE=0
SKIP_HOST_CHECK=0
SKIP_ENV_CHECK=0
SKIP_STACK_CHECK=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --target-dir DIR          Use an alternate Quadlet target directory
  --frontend-build-env FILE Use an alternate frontend build env file
  --include-proxy           Include HTTPS probe via check-https.sh
  --resolve-ip ADDR         Pass through to check-https.sh for pre-DNS probe
  --insecure                Pass -k to check-https.sh
  --skip-host-check         Skip check-host-prereqs.sh
  --skip-env-check          Skip check-env.sh
  --skip-stack-check        Skip check-stack.sh
  -h, --help                Show this help message and exit
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run() {
  printf '==> %s\n' "$*"
  "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --target-dir'
      TARGET_DIR="$2"
      shift 2
      ;;
    --frontend-build-env)
      [[ $# -ge 2 ]] || fail 'missing argument for --frontend-build-env'
      FRONTEND_BUILD_ENV="$2"
      shift 2
      ;;
    --include-proxy)
      INCLUDE_PROXY=1
      shift
      ;;
    --resolve-ip)
      [[ $# -ge 2 ]] || fail 'missing argument for --resolve-ip'
      RESOLVE_IP="$2"
      shift 2
      ;;
    --insecure)
      INSECURE=1
      shift
      ;;
    --skip-host-check)
      SKIP_HOST_CHECK=1
      shift
      ;;
    --skip-env-check)
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

[[ -x "$CHECK_HOST" ]] || fail "helper is not executable: $CHECK_HOST"
[[ -x "$CHECK_ENV" ]] || fail "helper is not executable: $CHECK_ENV"
[[ -x "$CHECK_STACK" ]] || fail "helper is not executable: $CHECK_STACK"
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  [[ -x "$CHECK_HTTPS" ]] || fail "helper is not executable: $CHECK_HTTPS"
fi

if [[ "$SKIP_HOST_CHECK" -eq 0 ]]; then
  run "$CHECK_HOST"
fi

if [[ "$SKIP_ENV_CHECK" -eq 0 ]]; then
  run "$CHECK_ENV" --target-dir "$TARGET_DIR" --frontend-build-env "$FRONTEND_BUILD_ENV"
fi

if [[ "$SKIP_STACK_CHECK" -eq 0 ]]; then
  run "$CHECK_STACK"
fi

if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  cmd=("$CHECK_HTTPS" --target-dir "$TARGET_DIR")
  if [[ -n "$RESOLVE_IP" ]]; then
    cmd+=(--resolve-ip "$RESOLVE_IP")
  fi
  if [[ "$INSECURE" -eq 1 ]]; then
    cmd+=(--insecure)
  fi
  run "${cmd[@]}"
fi

printf 'OK: Quadlet trial readiness checks completed\n'
