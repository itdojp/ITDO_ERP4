#!/usr/bin/env bash
set -euo pipefail

SYSTEMCTL="${SYSTEMCTL:-systemctl}"
INCLUDE_PROXY=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --include-proxy    Disable erp4-caddy.service as part of stack shutdown
  -h, --help         Show this help message and exit
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

if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  run_systemctl_user disable erp4-caddy.service
  run_systemctl_user stop erp4-caddy.service
fi

run_systemctl_user disable \
  erp4-frontend.service \
  erp4-backend.service \
  erp4-migrate.service \
  erp4-postgres.service

run_systemctl_user stop erp4-frontend.service
run_systemctl_user stop erp4-backend.service
run_systemctl_user stop erp4-migrate.service
run_systemctl_user stop erp4-postgres.service

printf 'OK: Quadlet stack disabled and stopped\n'
