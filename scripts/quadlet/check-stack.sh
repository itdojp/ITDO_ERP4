#!/usr/bin/env bash
set -euo pipefail

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:3001/healthz}"
BACKEND_READY_URL="${BACKEND_READY_URL:-http://127.0.0.1:3001/readyz}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:8080/}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-erp4-postgres}"
POSTGRES_USER="${POSTGRES_USER:-erp4}"
SKIP_SYSTEMD=0
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-2}"
SERVICES=(erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service)
LAST_ERROR=""

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --backend-health-url URL
  --backend-ready-url URL
  --frontend-url URL
  --postgres-container NAME
  --postgres-user USER
  --timeout-seconds N
  --interval-seconds N
  --skip-systemd
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

check_once() {
  if [[ "$SKIP_SYSTEMD" -eq 0 ]]; then
    for service in "${SERVICES[@]}"; do
      if ! systemctl --user is-active --quiet "$service"; then
        LAST_ERROR="$service is not active yet"
        return 1
      fi
    done
  fi

  if ! curl -fsS "$BACKEND_HEALTH_URL" >/dev/null; then
    LAST_ERROR="backend health check failed: $BACKEND_HEALTH_URL"
    return 1
  fi

  if ! curl -fsS "$BACKEND_READY_URL" >/dev/null; then
    LAST_ERROR="backend ready check failed: $BACKEND_READY_URL"
    return 1
  fi

  if ! curl -fsSI "$FRONTEND_URL" >/dev/null; then
    LAST_ERROR="frontend check failed: $FRONTEND_URL"
    return 1
  fi

  if ! podman exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null; then
    LAST_ERROR="postgres readiness check failed: $POSTGRES_CONTAINER"
    return 1
  fi

  LAST_ERROR=""
}

dump_systemd_logs() {
  [[ "$SKIP_SYSTEMD" -eq 0 ]] || return 0
  for service in "${SERVICES[@]}"; do
    if ! systemctl --user is-active --quiet "$service"; then
      journalctl --user -u "$service" -n 50 --no-pager >&2 || true
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-health-url)
      [[ $# -ge 2 ]] || fail 'missing argument for --backend-health-url'
      BACKEND_HEALTH_URL="$2"
      shift 2
      ;;
    --backend-ready-url)
      [[ $# -ge 2 ]] || fail 'missing argument for --backend-ready-url'
      BACKEND_READY_URL="$2"
      shift 2
      ;;
    --frontend-url)
      [[ $# -ge 2 ]] || fail 'missing argument for --frontend-url'
      FRONTEND_URL="$2"
      shift 2
      ;;
    --postgres-container)
      [[ $# -ge 2 ]] || fail 'missing argument for --postgres-container'
      POSTGRES_CONTAINER="$2"
      shift 2
      ;;
    --postgres-user)
      [[ $# -ge 2 ]] || fail 'missing argument for --postgres-user'
      POSTGRES_USER="$2"
      shift 2
      ;;
    --timeout-seconds)
      [[ $# -ge 2 ]] || fail 'missing argument for --timeout-seconds'
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --interval-seconds)
      [[ $# -ge 2 ]] || fail 'missing argument for --interval-seconds'
      INTERVAL_SECONDS="$2"
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
ensure_positive_integer "$TIMEOUT_SECONDS" "--timeout-seconds"
ensure_positive_integer "$INTERVAL_SECONDS" "--interval-seconds"

if [[ "$SKIP_SYSTEMD" -eq 0 ]]; then
  command -v systemctl >/dev/null 2>&1 || fail 'required command not found: systemctl'
fi

deadline=$((SECONDS + TIMEOUT_SECONDS))
while true; do
  if check_once; then
    break
  fi

  if (( SECONDS >= deadline )); then
    dump_systemd_logs
    fail "$LAST_ERROR"
  fi

  sleep "$INTERVAL_SECONDS"
done

printf 'OK: backend=%s frontend=%s postgres=%s\n' "$BACKEND_HEALTH_URL" "$FRONTEND_URL" "$POSTGRES_CONTAINER"
