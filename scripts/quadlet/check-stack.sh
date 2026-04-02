#!/usr/bin/env bash
set -euo pipefail

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:3001/healthz}"
BACKEND_READY_URL="${BACKEND_READY_URL:-http://127.0.0.1:3001/readyz}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:8080/}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-erp4-postgres}"
POSTGRES_USER="${POSTGRES_USER:-erp4}"
SKIP_SYSTEMD=0
SERVICES=(erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service)

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --backend-health-url URL
  --backend-ready-url URL
  --frontend-url URL
  --postgres-container NAME
  --postgres-user USER
  --skip-systemd
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-health-url)
      BACKEND_HEALTH_URL="$2"
      shift 2
      ;;
    --backend-ready-url)
      BACKEND_READY_URL="$2"
      shift 2
      ;;
    --frontend-url)
      FRONTEND_URL="$2"
      shift 2
      ;;
    --postgres-container)
      POSTGRES_CONTAINER="$2"
      shift 2
      ;;
    --postgres-user)
      POSTGRES_USER="$2"
      shift 2
      ;;
    --skip-systemd)
      SKIP_SYSTEMD=1
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

command -v curl >/dev/null 2>&1 || fail 'required command not found: curl'
command -v podman >/dev/null 2>&1 || fail 'required command not found: podman'

if [[ "$SKIP_SYSTEMD" -eq 0 ]]; then
  command -v systemctl >/dev/null 2>&1 || fail 'required command not found: systemctl'
  for service in "${SERVICES[@]}"; do
    if ! systemctl --user is-active --quiet "$service"; then
      printf 'ERROR: %s is not active\n' "$service" >&2
      journalctl --user -u "$service" -n 50 --no-pager >&2 || true
      exit 1
    fi
  done
fi

curl -fsS "$BACKEND_HEALTH_URL" >/dev/null
curl -fsS "$BACKEND_READY_URL" >/dev/null
curl -fsSI "$FRONTEND_URL" >/dev/null
podman exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null

printf 'OK: backend=%s frontend=%s postgres=%s\n' "$BACKEND_HEALTH_URL" "$FRONTEND_URL" "$POSTGRES_CONTAINER"
