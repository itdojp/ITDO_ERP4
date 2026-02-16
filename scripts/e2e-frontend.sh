#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-3002}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
E2E_DB_MODE="${E2E_DB_MODE:-podman}"
E2E_PODMAN_CONTAINER_NAME="${E2E_PODMAN_CONTAINER_NAME:-erp4-pg-e2e}"
E2E_PODMAN_HOST_PORT_EXPLICIT=0
if [[ -n "${E2E_PODMAN_HOST_PORT+x}" && -n "${E2E_PODMAN_HOST_PORT:-}" ]]; then
  E2E_PODMAN_HOST_PORT_EXPLICIT=1
fi
E2E_PODMAN_HOST_PORT="${E2E_PODMAN_HOST_PORT:-55433}"
E2E_PODMAN_RESET="${E2E_PODMAN_RESET:-1}"

port_in_use() {
  local port="$1"
  # NOTE: LISTEN だけでなく、確立済み接続等でローカルポートが使用中の場合も bind が失敗し得るため、
  #       すべての TCP ソケットを対象に確認する。
  ss -tanH 2>/dev/null | awk -v p="$port" '$4 ~ ":" p "$" { found=1 } END { exit found ? 0 : 1 }'
}

PODMAN_PORTS_CACHE="${PODMAN_PORTS_CACHE:-}"
PODMAN_PORTS_CACHE_LOADED="${PODMAN_PORTS_CACHE_LOADED:-0}"

podman_ports_cache() {
  if [[ "$PODMAN_PORTS_CACHE_LOADED" == "1" ]]; then
    printf '%s' "$PODMAN_PORTS_CACHE"
    return 0
  fi
  if ! command -v podman >/dev/null 2>&1; then
    PODMAN_PORTS_CACHE=""
    PODMAN_PORTS_CACHE_LOADED="1"
    return 0
  fi
  PODMAN_PORTS_CACHE="$(podman ps -a --format "{{.Ports}}" 2>/dev/null || true)"
  PODMAN_PORTS_CACHE_LOADED="1"
  printf '%s' "$PODMAN_PORTS_CACHE"
}

podman_port_reserved() {
  local port="$1"
  # podman ps -a の Ports 表記例:
  # - 0.0.0.0:55433->5432/tcp
  # - :::55433->5432/tcp
  # - 0.0.0.0:8000-8005->8000-8005/tcp
  # 停止中コンテナでも Ports が残るため、rootlessport の bind エラー回避目的で予約扱いにする。
  podman_ports_cache | tr ',' '\n' | awk -v p="$port" '
    BEGIN { pnum = p + 0; found = 0 }
    {
      if (index($0, "->") == 0) next
      split($0, a, "->")
      host = a[1]
      gsub(/^[ \t]+|[ \t]+$/, "", host)

      n = split(host, parts, ":")
      portSpec = parts[n]
      rlen = split(portSpec, r, "-")
      if (rlen == 1) {
        if ((r[1] + 0) == pnum) { found = 1; exit }
      } else if (rlen == 2) {
        start = r[1] + 0
        end = r[2] + 0
        if (start <= pnum && pnum <= end) { found = 1; exit }
      }
    }
    END { exit found ? 0 : 1 }
  '
}

port_unavailable_for_podman() {
  local port="$1"
  port_in_use "$port" || podman_port_reserved "$port"
}

if [[ "$E2E_DB_MODE" == "podman" ]] && port_unavailable_for_podman "$E2E_PODMAN_HOST_PORT"; then
  if [[ "$E2E_PODMAN_HOST_PORT_EXPLICIT" == "1" ]]; then
    echo "E2E_PODMAN_HOST_PORT=${E2E_PODMAN_HOST_PORT} is already in use (or reserved by podman)." >&2
    echo "Set an unused port, e.g.: E2E_PODMAN_HOST_PORT=55435 ./scripts/e2e-frontend.sh" >&2
    exit 1
  fi
  original_port="$E2E_PODMAN_HOST_PORT"
  for port in $(seq "$E2E_PODMAN_HOST_PORT" "$((E2E_PODMAN_HOST_PORT + 100))"); do
    if ! port_unavailable_for_podman "$port"; then
      E2E_PODMAN_HOST_PORT="$port"
      echo "Port ${original_port} is unavailable; falling back to ${E2E_PODMAN_HOST_PORT}"
      break
    fi
  done
  if port_unavailable_for_podman "$E2E_PODMAN_HOST_PORT"; then
    echo "Failed to find a free port for e2e db (starting from ${E2E_PODMAN_HOST_PORT})." >&2
    echo "Set an unused port, e.g.: E2E_PODMAN_HOST_PORT=55435 ./scripts/e2e-frontend.sh" >&2
    exit 1
  fi
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ "$E2E_DB_MODE" == "podman" ]]; then
    DATABASE_URL="postgresql://postgres:postgres@localhost:${E2E_PODMAN_HOST_PORT}/postgres?schema=public"
  else
    echo "DATABASE_URL is required when E2E_DB_MODE=direct" >&2
    exit 1
  fi
fi
if [[ -z "${DATABASE_URL_PSQL:-}" ]]; then
  DATABASE_URL_PSQL="$DATABASE_URL"
  if [[ "$DATABASE_URL_PSQL" == *"?"* ]]; then
    base="${DATABASE_URL_PSQL%%\?*}"
    query="${DATABASE_URL_PSQL#*\?}"
    new_query=""
    IFS='&' read -r -a params <<< "$query"
    for param in "${params[@]}"; do
      if [[ "$param" == schema=* ]]; then
        continue
      fi
      if [[ -z "$new_query" ]]; then
        new_query="$param"
      else
        new_query="${new_query}&${param}"
      fi
    done
    if [[ -n "$new_query" ]]; then
      DATABASE_URL_PSQL="${base}?${new_query}"
    else
      DATABASE_URL_PSQL="$base"
    fi
  fi
fi
E2E_DATE="${E2E_DATE:-$(date +%Y-%m-%d)}"
E2E_EVIDENCE_DIR="${E2E_EVIDENCE_DIR:-$ROOT_DIR/docs/test-results/${E2E_DATE}-frontend-e2e}"
E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:${FRONTEND_PORT}}"
E2E_CAPTURE="${E2E_CAPTURE:-1}"
E2E_SCOPE="${E2E_SCOPE:-full}"
E2E_GREP="${E2E_GREP:-}"
E2E_SERVICE_READY_TIMEOUT_SEC="${E2E_SERVICE_READY_TIMEOUT_SEC:-80}"
E2E_SERVICE_READY_INTERVAL_SEC="${E2E_SERVICE_READY_INTERVAL_SEC:-1}"

BACKEND_LOG="$ROOT_DIR/tmp/e2e-backend.log"
FRONTEND_LOG="$ROOT_DIR/tmp/e2e-frontend.log"

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    pkill -P "$FRONTEND_PID" >/dev/null 2>&1 || true
    kill "$FRONTEND_PID" || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" || true
  fi
  for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    local pid
    pid=$(ss -ltnp | awk -v p=":$port" '$4 ~ p { if (match($0, /pid=([0-9]+)/, a)) print a[1]; }' | head -n 1)
    if [[ -n "${pid:-}" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT

wait_for_url() {
  local url=$1
  local name=$2
  local timeout="${E2E_SERVICE_READY_TIMEOUT_SEC}"
  local interval="${E2E_SERVICE_READY_INTERVAL_SEC}"
  local attempts

  if ! [[ "$timeout" =~ ^[0-9]+$ ]] || [[ "$timeout" -lt 1 ]]; then
    echo "E2E_SERVICE_READY_TIMEOUT_SEC must be a positive integer" >&2
    return 1
  fi
  if ! [[ "$interval" =~ ^[0-9]+$ ]] || [[ "$interval" -lt 1 ]]; then
    echo "E2E_SERVICE_READY_INTERVAL_SEC must be a positive integer" >&2
    return 1
  fi
  if [[ "$interval" -gt "$timeout" ]]; then
    echo "E2E_SERVICE_READY_INTERVAL_SEC must be <= E2E_SERVICE_READY_TIMEOUT_SEC" >&2
    return 1
  fi

  attempts=$(((timeout + interval - 1) / interval))

  for _ in $(seq 1 "$attempts"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "$name ready"
      return 0
    fi
    sleep "$interval"
  done
  echo "$name not ready after ${timeout}s" >&2
  return 1
}

mkdir -p "$ROOT_DIR/tmp"
if [[ "$E2E_CAPTURE" != "0" ]]; then
  mkdir -p "$E2E_EVIDENCE_DIR"
fi

if [[ ! -d "$ROOT_DIR/packages/backend/node_modules" ]]; then
  npm install --prefix "$ROOT_DIR/packages/backend"
fi
if [[ ! -d "$ROOT_DIR/packages/frontend/node_modules" ]]; then
  npm install --prefix "$ROOT_DIR/packages/frontend"
fi

wait_for_db() {
  for _ in $(seq 1 30); do
    if psql "$DATABASE_URL_PSQL" -c "select 1" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

case "$E2E_DB_MODE" in
  podman)
    if [[ "$E2E_PODMAN_RESET" == "1" ]]; then
      CONTAINER_NAME="$E2E_PODMAN_CONTAINER_NAME" HOST_PORT="$E2E_PODMAN_HOST_PORT" \
        "$ROOT_DIR/scripts/podman-poc.sh" stop >/dev/null 2>&1 || true
    fi
    CONTAINER_NAME="$E2E_PODMAN_CONTAINER_NAME" HOST_PORT="$E2E_PODMAN_HOST_PORT" \
      "$ROOT_DIR/scripts/podman-poc.sh" db-push
    CONTAINER_NAME="$E2E_PODMAN_CONTAINER_NAME" HOST_PORT="$E2E_PODMAN_HOST_PORT" \
      "$ROOT_DIR/scripts/podman-poc.sh" seed
    ;;
  direct)
    if ! command -v psql >/dev/null 2>&1; then
      echo "psql command not found; install postgresql-client for direct mode" >&2
      exit 1
    fi
    if ! wait_for_db; then
      echo "database not ready for direct mode" >&2
      exit 1
    fi
    DATABASE_URL="$DATABASE_URL" npx --prefix "$ROOT_DIR/packages/backend" prisma db push \
      --config "$ROOT_DIR/packages/backend/prisma.config.ts"
    psql "$DATABASE_URL_PSQL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/scripts/seed-demo.sql"
    ;;
  *)
    echo "Unknown E2E_DB_MODE: $E2E_DB_MODE" >&2
    exit 1
    ;;
esac

DATABASE_URL="$DATABASE_URL" npm run prisma:generate --prefix "$ROOT_DIR/packages/backend"
npm run build --prefix "$ROOT_DIR/packages/backend"

PORT="$BACKEND_PORT" AUTH_MODE=header DATABASE_URL="$DATABASE_URL" \
ALLOWED_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}" \
CHAT_EXTERNAL_LLM_PROVIDER="${CHAT_EXTERNAL_LLM_PROVIDER:-stub}" \
  node "$ROOT_DIR/packages/backend/dist/index.js" >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
if ! wait_for_url "http://localhost:${BACKEND_PORT}/health" "backend"; then
  if [[ -f "$BACKEND_LOG" ]]; then
    echo "backend log:" >&2
    tail -n 200 "$BACKEND_LOG" >&2
  fi
  exit 1
fi

VITE_API_BASE="http://localhost:${BACKEND_PORT}" \
  npm run dev --prefix "$ROOT_DIR/packages/frontend" -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
  >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
if ! wait_for_url "http://localhost:${FRONTEND_PORT}/" "frontend"; then
  if [[ -f "$FRONTEND_LOG" ]]; then
    echo "frontend log:" >&2
    tail -n 200 "$FRONTEND_LOG" >&2
  fi
  exit 1
fi

if [[ "${E2E_SKIP_PLAYWRIGHT_INSTALL:-}" != "1" ]]; then
  npx --prefix "$ROOT_DIR/packages/frontend" playwright install chromium
fi

if [[ -z "$E2E_GREP" ]]; then
  case "$E2E_SCOPE" in
    core)
      E2E_GREP="@core"
      ;;
    extended)
      E2E_GREP="@extended"
      ;;
    full)
      ;;
    *)
      echo "Unknown E2E_SCOPE: $E2E_SCOPE" >&2
      exit 1
      ;;
  esac
fi

E2E_ROOT_DIR="$ROOT_DIR" \
E2E_EVIDENCE_DIR="$E2E_EVIDENCE_DIR" \
E2E_BASE_URL="$E2E_BASE_URL" \
E2E_API_BASE="http://localhost:${BACKEND_PORT}" \
E2E_CAPTURE="$E2E_CAPTURE" \
  npx --prefix "$ROOT_DIR/packages/frontend" playwright test --config "$ROOT_DIR/packages/frontend/playwright.config.ts" ${E2E_GREP:+--grep "$E2E_GREP"}

echo "e2e evidence saved: $E2E_EVIDENCE_DIR"
