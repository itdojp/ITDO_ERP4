#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_ENV="$ROOT_DIR/scripts/quadlet/check-env.sh"
CHECK_STACK="$ROOT_DIR/scripts/quadlet/check-stack.sh"
TARGET_DIR="$HOME/.config/containers/systemd"
SKIP_BUILD_ENV_CHECK=0
SKIP_STACK_CHECK=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --skip-build-env-check  Skip environment validation performed by check-env.sh
  --skip-stack-check      Skip post-start validation performed by check-stack.sh
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build-env-check)
      SKIP_BUILD_ENV_CHECK=1
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

command -v systemctl >/dev/null 2>&1 || fail 'required command not found: systemctl'

if [[ "$SKIP_BUILD_ENV_CHECK" -eq 0 ]]; then
  "$CHECK_ENV" --target-dir "$TARGET_DIR"
fi

systemctl --user daemon-reload
systemctl --user enable --now erp4-postgres.service
systemctl --user enable --now erp4-migrate.service
systemctl --user enable --now erp4-backend.service
systemctl --user enable --now erp4-frontend.service

if [[ "$SKIP_STACK_CHECK" -eq 0 ]]; then
  "$CHECK_STACK"
fi

printf 'OK: Quadlet stack started from %s\n' "$TARGET_DIR"
