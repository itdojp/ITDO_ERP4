#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONTAINER_NAME="${CONTAINER_NAME:-erp4-clamav}"
HOST_PORT="${HOST_PORT:-3310}"
CLAMAV_IMAGE="${CLAMAV_IMAGE:-docker.io/clamav/clamav:latest}"

usage() {
  cat <<USAGE
Usage: $0 <start|stop|status|logs|check>

start  : start clamd container (if missing, create)
stop   : stop and remove clamd container
status : show podman ps entry for container (if exists)
logs   : tail logs (follow)
check  : run clamd INSTREAM check (EICAR) via scripts/check-chat-clamav.ts

Environment variables:
  CONTAINER_NAME (default: erp4-clamav)
  HOST_PORT      (default: 3310)
  CLAMAV_IMAGE   (default: docker.io/clamav/clamav:latest)
  WAIT_HOST      (default: 127.0.0.1)   # used by 'check' readiness wait
  WAIT_PORT      (default: HOST_PORT)   # used by 'check' readiness wait
  WAIT_TIMEOUT_SEC (default: 300)       # used by 'check' readiness wait
USAGE
}

container_exists() {
  podman ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"
}

container_running() {
  podman ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"
}

can_connect() {
  local host="$1"
  local port="$2"
  (exec 3<>"/dev/tcp/${host}/${port}") >/dev/null 2>&1
}

clamd_ping() {
  local host="$1"
  local port="$2"
  local response_timeout_sec=2
  local max_response_bytes=64

  if ! exec 3<>"/dev/tcp/${host}/${port}" 2>/dev/null; then
    return 1
  fi
  if ! printf 'PING\0' >&3; then
    exec 3<&- 3>&- 2>/dev/null || true
    return 1
  fi

  local response
  response=$(
    timeout "$response_timeout_sec" dd bs=1 count="$max_response_bytes" <&3 2>/dev/null | tr -d '\0' || true
  )
  exec 3<&- 3>&- 2>/dev/null || true

  [[ "${response^^}" == *PONG* ]]
}

wait_ready() {
  local host="${WAIT_HOST:-127.0.0.1}"
  local port="${WAIT_PORT:-$HOST_PORT}"
  local timeout_sec="${WAIT_TIMEOUT_SEC:-300}"
  local start_ts
  start_ts="$(date +%s)"

  while ! clamd_ping "$host" "$port"; do
    if (( $(date +%s) - start_ts >= timeout_sec )); then
      echo "clamav not ready after ${timeout_sec}s: ${host}:${port}" >&2
      return 1
    fi
    sleep 1
  done
}

start_container() {
  if container_exists; then
    if ! container_running; then
      podman start "$CONTAINER_NAME" >/dev/null
    fi
  else
    podman run -d --name "$CONTAINER_NAME" \
      -p "$HOST_PORT":3310 \
      "$CLAMAV_IMAGE" >/dev/null
  fi
  echo "clamav container started: $CONTAINER_NAME (host port: $HOST_PORT)"
}

stop_container() {
  if container_exists; then
    podman stop "$CONTAINER_NAME" >/dev/null || true
    podman rm "$CONTAINER_NAME" >/dev/null || true
    echo "clamav stopped: $CONTAINER_NAME"
  fi
}

status() {
  if container_exists; then
    podman ps -a --filter "name=^${CONTAINER_NAME}$" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  else
    echo "container not found: $CONTAINER_NAME" >&2
    return 1
  fi
}

logs() {
  if ! container_exists; then
    echo "container not found: $CONTAINER_NAME" >&2
    return 1
  fi
  podman logs -f "$CONTAINER_NAME"
}

check() {
  start_container
  wait_ready
  CLAMAV_HOST="${CLAMAV_HOST:-127.0.0.1}" \
    CLAMAV_PORT="${CLAMAV_PORT:-$HOST_PORT}" \
    CLAMAV_TIMEOUT_MS="${CLAMAV_TIMEOUT_MS:-10000}" \
    npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json \
    "$ROOT_DIR/scripts/check-chat-clamav.ts"
}

cmd="${1:-}"
case "$cmd" in
  start)
    start_container
    ;;
  stop)
    stop_container
    ;;
  status)
    status
    ;;
  logs)
    logs
    ;;
  check)
    check
    ;;
  *)
    usage
    exit 1
    ;;
esac
