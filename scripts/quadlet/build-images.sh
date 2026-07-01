#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_IMAGE="${NODE_IMAGE:-docker.io/library/node:20-bookworm-slim@sha256:3d0f05455dea2c82e2f76e7e2543964c30f6b7d673fc1a83286736d44fe4c41c}"
NGINX_IMAGE="${NGINX_IMAGE:-docker.io/library/nginx:1.29-alpine@sha256:3bcf852aed06467cf075c6105892e4d5a6ebbbafa0ce22d35062db9e90ddef4c}"
BACKEND_BUILD_DATABASE_URL="${BACKEND_BUILD_DATABASE_URL:-postgresql://user:password@localhost:5432/postgres?schema=public}"
FRONTEND_BUILD_ENV_FILE="${FRONTEND_BUILD_ENV_FILE:-$ROOT_DIR/deploy/quadlet/env/erp4-frontend-build.env}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

resolve_image_tag() {
  local tag="${ERP4_IMAGE_TAG:-}"
  if [[ -z "$tag" ]]; then
    if tag="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null)"; then
      :
    else
      fail "ERP4_IMAGE_TAG is required when the repository commit cannot be resolved"
    fi
  fi
  if [[ ! "$tag" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    fail "ERP4_IMAGE_TAG contains characters that are unsafe for an image tag: $tag"
  fi
  printf '%s\n' "$tag"
}

ERP4_IMAGE_TAG="$(resolve_image_tag)"
export ERP4_IMAGE_TAG
BACKEND_IMAGE="${BACKEND_IMAGE:-localhost/erp4-backend:${ERP4_IMAGE_TAG}}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-localhost/erp4-frontend:${ERP4_IMAGE_TAG}}"

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

printf 'Building ERP4 images with ERP4_IMAGE_TAG=%s\n' "$ERP4_IMAGE_TAG"
printf '  backend: %s\n' "$BACKEND_IMAGE"
printf '  frontend: %s\n' "$FRONTEND_IMAGE"

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
