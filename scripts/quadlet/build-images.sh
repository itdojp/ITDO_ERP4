#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_IMAGE="${BACKEND_IMAGE:-localhost/erp4-backend:latest}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-localhost/erp4-frontend:latest}"
NODE_IMAGE="${NODE_IMAGE:-docker.io/library/node:20-bookworm-slim}"
NGINX_IMAGE="${NGINX_IMAGE:-docker.io/library/nginx:1.29-alpine}"
BACKEND_BUILD_DATABASE_URL="${BACKEND_BUILD_DATABASE_URL:-postgresql://user:password@localhost:5432/postgres?schema=public}"
FRONTEND_BUILD_ENV_FILE="${FRONTEND_BUILD_ENV_FILE:-$ROOT_DIR/deploy/quadlet/env/erp4-frontend-build.env}"

if [[ -f "$FRONTEND_BUILD_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$FRONTEND_BUILD_ENV_FILE"
  set +a
fi

: "${VITE_API_BASE:=}"
: "${VITE_ENABLE_SW:=true}"
: "${VITE_PUSH_PUBLIC_KEY:=}"
: "${VITE_GOOGLE_CLIENT_ID:=}"
: "${VITE_FEATURE_TIMESHEET_GRID:=false}"

podman build \
  --build-arg NODE_IMAGE="$NODE_IMAGE" \
  --build-arg BACKEND_BUILD_DATABASE_URL="$BACKEND_BUILD_DATABASE_URL" \
  --file "$ROOT_DIR/deploy/containers/backend.Containerfile" \
  --tag "$BACKEND_IMAGE" \
  "$ROOT_DIR"

podman build \
  --build-arg NODE_IMAGE="$NODE_IMAGE" \
  --build-arg NGINX_IMAGE="$NGINX_IMAGE" \
  --build-arg VITE_API_BASE="$VITE_API_BASE" \
  --build-arg VITE_ENABLE_SW="$VITE_ENABLE_SW" \
  --build-arg VITE_PUSH_PUBLIC_KEY="$VITE_PUSH_PUBLIC_KEY" \
  --build-arg VITE_GOOGLE_CLIENT_ID="$VITE_GOOGLE_CLIENT_ID" \
  --build-arg VITE_FEATURE_TIMESHEET_GRID="$VITE_FEATURE_TIMESHEET_GRID" \
  --file "$ROOT_DIR/deploy/containers/frontend.Containerfile" \
  --tag "$FRONTEND_IMAGE" \
  "$ROOT_DIR"
