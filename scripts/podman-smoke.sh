#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_PORT="${HOST_PORT:-55432}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:${HOST_PORT}/postgres?schema=public}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${BACKEND_PORT}}"
BACKEND_LOG="${BACKEND_LOG:-$ROOT_DIR/tmp/podman-smoke-backend.log}"

BACKEND_PID=""

cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_backend() {
  for _ in $(seq 1 60); do
    if curl -sf "${BASE_URL}/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

mkdir -p "$ROOT_DIR/tmp"

HOST_PORT="$HOST_PORT" "$ROOT_DIR/scripts/podman-poc.sh" reset
npm run build --prefix "$ROOT_DIR/packages/backend"

DATABASE_URL="$DATABASE_URL" PORT="$BACKEND_PORT" \
  node "$ROOT_DIR/packages/backend/dist/index.js" >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

if ! wait_for_backend; then
  echo "backend did not become ready: ${BASE_URL}/healthz" >&2
  echo "backend log: $BACKEND_LOG" >&2
  exit 1
fi

BASE_URL="$BASE_URL" "$ROOT_DIR/scripts/smoke-backend.sh"
echo "podman smoke ok"
