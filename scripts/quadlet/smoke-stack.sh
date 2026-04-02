#!/usr/bin/env bash
set -euo pipefail

BACKEND_IMAGE="${BACKEND_IMAGE:-localhost/erp4-backend:latest}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-localhost/erp4-frontend:latest}"
NETWORK_NAME="${NETWORK_NAME:-erp4-quadlet-smoke}"
POSTGRES_VOLUME="${POSTGRES_VOLUME:-erp4-quadlet-smoke-pg}"
BACKEND_VOLUME="${BACKEND_VOLUME:-erp4-quadlet-smoke-data}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-erp4-quadlet-smoke-pg}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-erp4-quadlet-smoke-backend}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-erp4-quadlet-smoke-frontend}"
BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-3007}"
FRONTEND_HOST_PORT="${FRONTEND_HOST_PORT:-8087}"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-55437}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  podman rm -f "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  podman network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
  podman volume rm "$POSTGRES_VOLUME" "$BACKEND_VOLUME" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

podman rm -f "$FRONTEND_CONTAINER" "$BACKEND_CONTAINER" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
podman network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
podman volume rm "$POSTGRES_VOLUME" "$BACKEND_VOLUME" >/dev/null 2>&1 || true

openssl genrsa -out "$TMP_DIR/jwt-private.pem" 2048 >/dev/null 2>&1
openssl rsa -in "$TMP_DIR/jwt-private.pem" -pubout -out "$TMP_DIR/jwt-public.pem" >/dev/null 2>&1
JWT_PUBLIC_KEY="$(python -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).read_text().strip().replace("\n", "\\n"))' "$TMP_DIR/jwt-public.pem")"

cat > "$TMP_DIR/postgres.env" <<POSTGRES
POSTGRES_USER=erp4
POSTGRES_PASSWORD=erp4pass
POSTGRES_DB=postgres
POSTGRES

cat > "$TMP_DIR/backend.env" <<BACKEND
DATABASE_URL=postgresql://erp4:erp4pass@${POSTGRES_CONTAINER}:5432/postgres?schema=public
PORT=3001
NODE_ENV=production
AUTH_MODE=jwt_bff
ALLOWED_ORIGINS=http://127.0.0.1:${FRONTEND_HOST_PORT}
JWT_ISSUER=test-issuer
JWT_AUDIENCE=test-audience
JWT_PUBLIC_KEY=${JWT_PUBLIC_KEY}
GOOGLE_OIDC_CLIENT_SECRET=smoke-secret
GOOGLE_OIDC_REDIRECT_URI=http://127.0.0.1:${BACKEND_HOST_PORT}/auth/google/callback
AUTH_FRONTEND_ORIGIN=http://127.0.0.1:${FRONTEND_HOST_PORT}
AUTH_SESSION_COOKIE_SECURE=false
MAIL_TRANSPORT=stub
PDF_PROVIDER=local
PDF_STORAGE_DIR=/var/lib/erp4/pdfs
PDF_BASE_URL=http://127.0.0.1:${BACKEND_HOST_PORT}/pdf-files
EVIDENCE_ARCHIVE_PROVIDER=local
EVIDENCE_ARCHIVE_LOCAL_DIR=/var/lib/erp4/evidence-archives
CHAT_ATTACHMENT_PROVIDER=local
CHAT_ATTACHMENT_LOCAL_DIR=/var/lib/erp4/chat-attachments
REPORT_STORAGE_DIR=/var/lib/erp4/reports
BACKEND

podman network create "$NETWORK_NAME" >/dev/null
podman volume create "$POSTGRES_VOLUME" >/dev/null
podman volume create "$BACKEND_VOLUME" >/dev/null

podman run -d \
  --name "$POSTGRES_CONTAINER" \
  --network "$NETWORK_NAME" \
  --env-file "$TMP_DIR/postgres.env" \
  -e PGDATA=/var/lib/postgresql/data/pgdata \
  -v "$POSTGRES_VOLUME":/var/lib/postgresql/data:Z \
  -p "127.0.0.1:${POSTGRES_HOST_PORT}:5432" \
  docker.io/library/postgres:15 >/dev/null

for _ in $(seq 1 60); do
  if podman exec "$POSTGRES_CONTAINER" pg_isready -U erp4 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
podman exec "$POSTGRES_CONTAINER" pg_isready -U erp4 >/dev/null

podman run --rm \
  --name erp4-quadlet-smoke-migrate \
  --network "$NETWORK_NAME" \
  --env-file "$TMP_DIR/backend.env" \
  "$BACKEND_IMAGE" \
  npx --prefix packages/backend prisma migrate deploy --config packages/backend/prisma.config.ts >/dev/null

podman run -d \
  --name "$BACKEND_CONTAINER" \
  --network "$NETWORK_NAME" \
  --env-file "$TMP_DIR/backend.env" \
  -v "$BACKEND_VOLUME":/var/lib/erp4:Z \
  -p "127.0.0.1:${BACKEND_HOST_PORT}:3001" \
  "$BACKEND_IMAGE" >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BACKEND_HOST_PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${BACKEND_HOST_PORT}/healthz"

podman run -d \
  --name "$FRONTEND_CONTAINER" \
  -p "127.0.0.1:${FRONTEND_HOST_PORT}:8080" \
  "$FRONTEND_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsSI "http://127.0.0.1:${FRONTEND_HOST_PORT}/" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsSI "http://127.0.0.1:${FRONTEND_HOST_PORT}/" | sed -n '1,5p'
