#!/usr/bin/env bash
set -euo pipefail

LINES=100
FOLLOW=0
SERVICES=(erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service)

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --lines N          Show the last N log lines per service (default: 100)
  --follow           Follow logs after printing recent entries
  --include-proxy    Include erp4-caddy.service
  --service UNIT     Restrict output to a specific user unit (repeatable)
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

ensure_positive_integer() {
  local value="$1"
  local name="$2"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || fail "$name must be a positive integer"
}

CUSTOM_SERVICES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lines)
      [[ $# -ge 2 ]] || fail 'missing argument for --lines'
      LINES="$2"
      shift 2
      ;;
    --follow)
      FOLLOW=1
      shift
      ;;
    --include-proxy)
      SERVICES+=(erp4-caddy.service)
      shift
      ;;
    --service)
      [[ $# -ge 2 ]] || fail 'missing argument for --service'
      CUSTOM_SERVICES+=("$2")
      shift 2
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

command -v journalctl >/dev/null 2>&1 || fail 'required command not found: journalctl'
ensure_positive_integer "$LINES" '--lines'

if [[ ${#CUSTOM_SERVICES[@]} -gt 0 ]]; then
  SERVICES=("${CUSTOM_SERVICES[@]}")
fi

args=(--user --no-pager)
for service in "${SERVICES[@]}"; do
  args+=(-u "$service")
done
args+=(-n "$LINES")
if [[ "$FOLLOW" -eq 1 ]]; then
  args+=(-f)
fi

journalctl "${args[@]}"
