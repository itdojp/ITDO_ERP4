#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage: $(basename "$0")
  Stop the ERP4 Quadlet stack in reverse dependency order.
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

systemctl --user stop erp4-frontend.service
systemctl --user stop erp4-backend.service
systemctl --user stop erp4-migrate.service
systemctl --user stop erp4-postgres.service

printf 'OK: Quadlet stack stopped\n'
