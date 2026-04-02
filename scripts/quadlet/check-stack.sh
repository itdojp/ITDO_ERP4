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
DEADLINE=0

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

remaining_seconds() {
  local remaining=$((DEADLINE - SECONDS))
  if (( remaining <= 0 )); then
    return 1
  fi
  printf '%s\n' "$remaining"
}

curl_probe() {
  local label="$1"
  local url="$2"
  local method="$3"
  local remaining connect_timeout curl_output

  remaining="$(remaining_seconds)" || {
    LAST_ERROR="${label} timed out before probe could start: $url"
    return 1
  }

  connect_timeout="$remaining"
  if (( connect_timeout > INTERVAL_SECONDS )); then
    connect_timeout="$INTERVAL_SECONDS"
  fi

  if [[ "$method" == "HEAD" ]]; then
    if ! curl_output="$(curl -fsS -I -o /dev/null --connect-timeout "$connect_timeout" --max-time "$remaining" "$url" 2>&1)"; then
      curl_output="${curl_output//$'\n'/ }"
      LAST_ERROR="${label} failed: $url (${curl_output:-unknown curl error})"
      return 1
    fi
    return 0
  fi

  if ! curl_output="$(curl -fsS -o /dev/null --connect-timeout "$connect_timeout" --max-time "$remaining" "$url" 2>&1)"; then
    curl_output="${curl_output//$'\n'/ }"
    LAST_ERROR="${label} failed: $url (${curl_output:-unknown curl error})"
    return 1
  fi
}

check_once() {
  if [[ "$SKIP_SYSTEMD" -eq 0 ]]; then
    for service in "${SERVICES[@]}"; do
      local status_output
      if ! status_output="$(systemctl --user is-active "$service" 2>&1)"; then
        status_output="${status_output//$'\n'/ }"
        if [[ "$status_output" == *"Failed to connect to bus"* ]]; then
          LAST_ERROR="failed to connect to systemd user bus while checking $service; consider --skip-systemd"
        else
          LAST_ERROR="$service is not active (${status_output:-unknown systemctl error})"
        fi
        return 1
      fi
    done
  fi

  curl_probe 'backend health check' "$BACKEND_HEALTH_URL" GET || return 1
  curl_probe 'backend ready check' "$BACKEND_READY_URL" GET || return 1
  curl_probe 'frontend check' "$FRONTEND_URL" HEAD || return 1

  local remaining
  remaining="$(remaining_seconds)" || {
    LAST_ERROR="postgres readiness check timed out before probe could start: $POSTGRES_CONTAINER"
    return 1
  }

  if ! podman exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" -t "$remaining" >/dev/null; then
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

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
while true; do
  if check_once; then
    break
  fi

  if (( SECONDS >= DEADLINE )); then
    dump_systemd_logs
    fail "$LAST_ERROR"
  fi

  sleep "$INTERVAL_SECONDS"
done

printf 'OK: backend=%s frontend=%s postgres=%s\n' "$BACKEND_HEALTH_URL" "$FRONTEND_URL" "$POSTGRES_CONTAINER"
