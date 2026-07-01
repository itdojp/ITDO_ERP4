#!/usr/bin/env bash
set -euo pipefail

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-}"
BACKEND_READY_URL="${BACKEND_READY_URL:-}"
FRONTEND_URL="${FRONTEND_URL:-}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-erp4-backend}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-erp4-frontend}"
BACKEND_CONTAINER_HEALTH_URL="${BACKEND_CONTAINER_HEALTH_URL:-http://127.0.0.1:3001/healthz}"
BACKEND_CONTAINER_READY_URL="${BACKEND_CONTAINER_READY_URL:-http://127.0.0.1:3001/readyz}"
FRONTEND_CONTAINER_URL="${FRONTEND_CONTAINER_URL:-http://127.0.0.1:8080/}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-erp4-postgres}"
POSTGRES_USER="${POSTGRES_USER:-erp4}"
SKIP_SYSTEMD=0
INCLUDE_PROXY=0
SERVICES=(erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service)
FAILED=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --backend-health-url URL       Probe backend health through an explicit host/proxy URL
  --backend-ready-url URL        Probe backend readiness through an explicit host/proxy URL
  --frontend-url URL             Probe frontend through an explicit host/proxy URL
  --backend-container NAME       Backend container name for default in-container probes
  --frontend-container NAME      Frontend container name for default in-container probes
  --postgres-container NAME
  --postgres-user USER
  --include-proxy
  --skip-systemd

If backend/frontend URLs are omitted, the checks run inside the Quadlet
containers. This matches the default deployment where only Caddy publishes host
ports and backend/frontend are private to the Podman network.
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

append_service_if_missing() {
  local service="$1"
  local existing
  for existing in "${SERVICES[@]}"; do
    [[ "$existing" == "$service" ]] && return 0
  done
  SERVICES+=("$service")
}

check_service_status() {
  local service="$1"
  local output

  if output="$(systemctl --user is-active "$service" 2>&1)"; then
    printf 'service %-24s %s\n' "$service" "$output"
    return 0
  fi

  output="${output//$'\n'/ }"
  if [[ "$output" == *"Failed to connect to bus"* ]]; then
    printf 'systemd %-24s unavailable\n' 'user bus'
    printf 'hint    %-24s %s\n' \
      'systemd user bus' \
      "rerun with --skip-systemd or run sudo loginctl enable-linger $(id -un)"
    FAILED=1
    return 2
  fi

  printf 'service %-24s %s\n' "$service" "${output:-unknown}"
  FAILED=1
  return 1
}

check_http_status() {
  local label="$1"
  local url="$2"
  local method="$3"
  local output

  if [[ "$method" == "HEAD" ]]; then
    if output="$(curl -fsS -I -o /dev/null --connect-timeout 5 --max-time 10 "$url" 2>&1)"; then
      printf 'http    %-24s ok (%s)\n' "$label" "$url"
      return 0
    fi
  else
    if output="$(curl -fsS -o /dev/null --connect-timeout 5 --max-time 10 "$url" 2>&1)"; then
      printf 'http    %-24s ok (%s)\n' "$label" "$url"
      return 0
    fi
  fi

  output="${output//$'\n'/ }"
  printf 'http    %-24s failed (%s) %s\n' "$label" "$url" "${output:-unknown}"
  FAILED=1
  return 1
}

check_node_http_status() {
  local label="$1"
  local container="$2"
  local url="$3"
  local method="$4"
  local output

  if output="$(podman exec "$container" node -e '
const http = require("node:http");
const [target, method] = process.argv.slice(1);
const request = http.request(target, { method, timeout: 5000 }, (response) => {
  response.resume();
  response.on("end", () => {
    if (response.statusCode >= 200 && response.statusCode < 400) {
      process.exit(0);
    }
    console.error("status " + response.statusCode);
    process.exit(1);
  });
});
request.on("timeout", () => request.destroy(new Error("timeout")));
request.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
request.end();
' "$url" "$method" 2>&1)"; then
    printf 'http    %-24s ok (container:%s:%s)\n' "$label" "$container" "$url"
    return 0
  fi

  output="${output//$'\n'/ }"
  printf 'http    %-24s failed (container:%s:%s) %s\n' "$label" "$container" "$url" "${output:-unknown}"
  FAILED=1
  return 1
}

check_wget_container_status() {
  local label="$1"
  local container="$2"
  local url="$3"
  local output

  if output="$(podman exec "$container" sh -c 'wget -q -O /dev/null -T 5 "$1"' sh "$url" 2>&1)"; then
    printf 'http    %-24s ok (container:%s:%s)\n' "$label" "$container" "$url"
    return 0
  fi

  output="${output//$'\n'/ }"
  printf 'http    %-24s failed (container:%s:%s) %s\n' "$label" "$container" "$url" "${output:-unknown}"
  FAILED=1
  return 1
}

check_backend_health_status() {
  if [[ -n "$BACKEND_HEALTH_URL" ]]; then
    check_http_status 'backend health' "$BACKEND_HEALTH_URL" GET
    return $?
  fi
  check_node_http_status 'backend health' "$BACKEND_CONTAINER" "$BACKEND_CONTAINER_HEALTH_URL" GET
}

check_backend_ready_status() {
  if [[ -n "$BACKEND_READY_URL" ]]; then
    check_http_status 'backend ready' "$BACKEND_READY_URL" GET
    return $?
  fi
  check_node_http_status 'backend ready' "$BACKEND_CONTAINER" "$BACKEND_CONTAINER_READY_URL" GET
}

check_frontend_status() {
  if [[ -n "$FRONTEND_URL" ]]; then
    check_http_status 'frontend' "$FRONTEND_URL" HEAD
    return $?
  fi
  check_wget_container_status 'frontend' "$FRONTEND_CONTAINER" "$FRONTEND_CONTAINER_URL"
}

check_postgres_status() {
  if podman exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" -t 5 >/dev/null 2>&1; then
    printf 'db      %-24s ok (%s)\n' 'postgres ready' "$POSTGRES_CONTAINER"
    return 0
  fi

  printf 'db      %-24s failed (%s)\n' 'postgres ready' "$POSTGRES_CONTAINER"
  FAILED=1
  return 1
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
    --backend-container)
      [[ $# -ge 2 ]] || fail 'missing argument for --backend-container'
      BACKEND_CONTAINER="$2"
      shift 2
      ;;
    --frontend-container)
      [[ $# -ge 2 ]] || fail 'missing argument for --frontend-container'
      FRONTEND_CONTAINER="$2"
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
    --include-proxy)
      INCLUDE_PROXY=1
      shift
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

if [[ -n "$BACKEND_HEALTH_URL$BACKEND_READY_URL$FRONTEND_URL" ]]; then
  command -v curl >/dev/null 2>&1 || fail 'required command not found: curl'
fi
command -v podman >/dev/null 2>&1 || fail 'required command not found: podman'

if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  append_service_if_missing 'erp4-caddy.service'
fi

if [[ "$SKIP_SYSTEMD" -eq 0 ]]; then
  command -v systemctl >/dev/null 2>&1 || fail 'required command not found: systemctl'
  printf '[systemd]\n'
  for service in "${SERVICES[@]}"; do
    status=0
    check_service_status "$service" || status=$?
    if [[ "$status" -eq 2 ]]; then
      break
    fi
  done
  printf '\n'
fi

printf '[probes]\n'
check_backend_health_status || true
check_backend_ready_status || true
check_frontend_status || true
check_postgres_status || true

if [[ "$FAILED" -ne 0 ]]; then
  exit 1
fi
