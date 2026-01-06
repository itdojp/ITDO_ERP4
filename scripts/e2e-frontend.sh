#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-3002}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:55432/postgres?schema=public}"
E2E_DATE="${E2E_DATE:-$(date +%Y-%m-%d)}"
E2E_EVIDENCE_DIR="${E2E_EVIDENCE_DIR:-$ROOT_DIR/docs/test-results/${E2E_DATE}-frontend-e2e}"
E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:${FRONTEND_PORT}}"
E2E_CAPTURE="${E2E_CAPTURE:-1}"

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
  for _ in $(seq 1 40); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "$name ready"
      return 0
    fi
    sleep 1
  done
  echo "$name not ready" >&2
  return 1
}

if [[ ! -d "$ROOT_DIR/packages/backend/node_modules" ]]; then
  npm install --prefix "$ROOT_DIR/packages/backend"
fi
if [[ ! -d "$ROOT_DIR/packages/frontend/node_modules" ]]; then
  npm install --prefix "$ROOT_DIR/packages/frontend"
fi

"$ROOT_DIR/scripts/podman-poc.sh" db-push
"$ROOT_DIR/scripts/podman-poc.sh" seed

npm run prisma:generate --prefix "$ROOT_DIR/packages/backend"
npm run build --prefix "$ROOT_DIR/packages/backend"

PORT="$BACKEND_PORT" AUTH_MODE=header DATABASE_URL="$DATABASE_URL" \
ALLOWED_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}" \
  node "$ROOT_DIR/packages/backend/dist/index.js" >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
wait_for_url "http://localhost:${BACKEND_PORT}/health" "backend"

VITE_API_BASE="http://localhost:${BACKEND_PORT}" \
  npm run dev --prefix "$ROOT_DIR/packages/frontend" -- --host 0.0.0.0 --port "$FRONTEND_PORT" \
  >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
wait_for_url "http://localhost:${FRONTEND_PORT}/" "frontend"

if [[ "${E2E_SKIP_PLAYWRIGHT_INSTALL:-}" != "1" ]]; then
  npx --prefix "$ROOT_DIR/packages/frontend" playwright install chromium
fi

E2E_ROOT_DIR="$ROOT_DIR" \
E2E_EVIDENCE_DIR="$E2E_EVIDENCE_DIR" \
E2E_BASE_URL="$E2E_BASE_URL" \
E2E_CAPTURE="$E2E_CAPTURE" \
  npx --prefix "$ROOT_DIR/packages/frontend" playwright test --config "$ROOT_DIR/packages/frontend/playwright.config.ts"

echo "e2e evidence saved: $E2E_EVIDENCE_DIR"
