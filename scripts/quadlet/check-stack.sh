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
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-2}"
SERVICES=(erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service)
LAST_ERROR=""
DEADLINE=0

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
  --timeout-seconds N
  --interval-seconds N
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

short_probe_timeout() {
  local remaining="$1"
  local timeout="$remaining"
  if (( timeout > INTERVAL_SECONDS )); then
    timeout="$INTERVAL_SECONDS"
  fi
  printf '%s\n' "$timeout"
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

  connect_timeout="$(short_probe_timeout "$remaining")"

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

node_http_probe() {
  local label="$1"
  local container="$2"
  local url="$3"
  local method="$4"
  local remaining timeout_seconds timeout_ms output

  remaining="$(remaining_seconds)" || {
    LAST_ERROR="${label} timed out before in-container probe could start: $container $url"
    return 1
  }
  timeout_seconds="$(short_probe_timeout "$remaining")"
  timeout_ms=$((timeout_seconds * 1000))

  if ! output="$(podman exec "$container" node -e '
const http = require("node:http");
const [target, method, timeoutMsText] = process.argv.slice(1);
const timeoutMs = Number(timeoutMsText) || 5000;
const request = http.request(target, { method, timeout: timeoutMs }, (response) => {
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
' "$url" "$method" "$timeout_ms" 2>&1)"; then
    output="${output//$'\n'/ }"
    LAST_ERROR="${label} failed in container $container: $url (${output:-unknown podman exec error})"
    return 1
  fi
}

wget_container_probe() {
  local label="$1"
  local container="$2"
  local url="$3"
  local remaining timeout_seconds output

  remaining="$(remaining_seconds)" || {
    LAST_ERROR="${label} timed out before in-container probe could start: $container $url"
    return 1
  }
  timeout_seconds="$(short_probe_timeout "$remaining")"

  if ! output="$(podman exec "$container" sh -c 'wget -q -O /dev/null -T "$1" "$2"' sh "$timeout_seconds" "$url" 2>&1)"; then
    output="${output//$'\n'/ }"
    LAST_ERROR="${label} failed in container $container: $url (${output:-unknown podman exec error})"
    return 1
  fi
}

probe_backend_health() {
  if [[ -n "$BACKEND_HEALTH_URL" ]]; then
    curl_probe 'backend health check' "$BACKEND_HEALTH_URL" GET
    return $?
  fi
  node_http_probe 'backend health check' "$BACKEND_CONTAINER" "$BACKEND_CONTAINER_HEALTH_URL" GET
}

probe_backend_ready() {
  if [[ -n "$BACKEND_READY_URL" ]]; then
    curl_probe 'backend ready check' "$BACKEND_READY_URL" GET
    return $?
  fi
  node_http_probe 'backend ready check' "$BACKEND_CONTAINER" "$BACKEND_CONTAINER_READY_URL" GET
}

probe_frontend() {
  if [[ -n "$FRONTEND_URL" ]]; then
    curl_probe 'frontend check' "$FRONTEND_URL" HEAD
    return $?
  fi
  wget_container_probe 'frontend check' "$FRONTEND_CONTAINER" "$FRONTEND_CONTAINER_URL"
}

backend_label() {
  if [[ -n "$BACKEND_HEALTH_URL" ]]; then
    printf '%s' "$BACKEND_HEALTH_URL"
  else
    printf 'container:%s:%s' "$BACKEND_CONTAINER" "$BACKEND_CONTAINER_HEALTH_URL"
  fi
}

frontend_label() {
  if [[ -n "$FRONTEND_URL" ]]; then
    printf '%s' "$FRONTEND_URL"
  else
    printf 'container:%s:%s' "$FRONTEND_CONTAINER" "$FRONTEND_CONTAINER_URL"
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

  probe_backend_health || return 1
  probe_backend_ready || return 1
  probe_frontend || return 1

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

if [[ -n "$BACKEND_HEALTH_URL$BACKEND_READY_URL$FRONTEND_URL" ]]; then
  command -v curl >/dev/null 2>&1 || fail 'required command not found: curl'
fi
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

printf 'OK: backend=%s frontend=%s postgres=%s\n' "$(backend_label)" "$(frontend_label)" "$POSTGRES_CONTAINER"
