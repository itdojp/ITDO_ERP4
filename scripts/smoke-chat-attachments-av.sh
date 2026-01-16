#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKEND_PORT="${BACKEND_PORT:-3003}"
BASE_URL="${BASE_URL:-http://localhost:${BACKEND_PORT}}"

DB_CONTAINER_NAME="${DB_CONTAINER_NAME:-erp4-pg-smoke-chat-av}"
DB_HOST_PORT="${DB_HOST_PORT:-55436}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:${DB_HOST_PORT}/postgres?schema=public}"

CLAMAV_CONTAINER_NAME="${CLAMAV_CONTAINER_NAME:-erp4-clamav-smoke}"
CLAMAV_HOST_PORT="${CLAMAV_HOST_PORT:-3311}"

USER_ID="${USER_ID:-demo-user}"
ROLES="${ROLES:-admin,mgmt}"
GROUP_IDS="${GROUP_IDS:-}"

ATTACH_DIR="${ATTACH_DIR:-$ROOT_DIR/tmp/chat-attachments-smoke}"
BACKEND_LOG="${BACKEND_LOG:-$ROOT_DIR/tmp/smoke-chat-attachments-av-backend.log}"
KEEP_ARTIFACTS="${KEEP_ARTIFACTS:-0}"

json_get() {
  if ! command -v python >/dev/null 2>&1; then
    echo "Error: python interpreter not found." >&2
    return 1
  fi

  python -c 'import json
import sys

if len(sys.argv) < 2:
    print("json_get error: path argument missing", file=sys.stderr)
    sys.exit(1)

path = sys.argv[1].split(".")
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError as exc:
    print(f"json_get error: failed to parse JSON: {exc}", file=sys.stderr)
    sys.exit(1)

for key in path:
    if data is None:
        break
    if key.isdigit():
        try:
            data = data[int(key)]
        except (IndexError, KeyError, TypeError, ValueError):
            data = None
            break
    else:
        if isinstance(data, dict):
            data = data.get(key)
        else:
            data = None
            break

print(data if data is not None else "")' "$1"
}

require_value() {
  local name=$1
  local value=$2
  if [[ -z "$value" ]]; then
    echo "Error: $name is empty" >&2
    exit 1
  fi
}

headers_for_json() {
  local headers=(
    -H "Content-Type: application/json"
    -H "x-user-id: $USER_ID"
    -H "x-roles: $ROLES"
  )
  if [[ -n "$GROUP_IDS" ]]; then
    headers+=(-H "x-group-ids: $GROUP_IDS")
  fi
  printf '%s\n' "${headers[@]}"
}

headers_for_multipart() {
  local headers=(
    -H "x-user-id: $USER_ID"
    -H "x-roles: $ROLES"
  )
  if [[ -n "$GROUP_IDS" ]]; then
    headers+=(-H "x-group-ids: $GROUP_IDS")
  fi
  printf '%s\n' "${headers[@]}"
}

post_json() {
  local url=$1
  local body=$2
  local out_body_file=$3
  mapfile -t headers < <(headers_for_json)
  curl -sS "${headers[@]}" -o "$out_body_file" -w "%{http_code}" \
    -X POST "$url" -d "$body"
}

upload_file() {
  local url=$1
  local file_path=$2
  local out_body_file=$3
  mapfile -t headers < <(headers_for_multipart)
  curl -sS "${headers[@]}" -o "$out_body_file" -w "%{http_code}" \
    -X POST -F "file=@${file_path}" \
    "$url"
}

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
  echo "$name not ready: $url" >&2
  return 1
}

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" || true
  fi
  CONTAINER_NAME="$DB_CONTAINER_NAME" HOST_PORT="$DB_HOST_PORT" \
    "$ROOT_DIR/scripts/podman-poc.sh" stop >/dev/null 2>&1 || true
  CONTAINER_NAME="$CLAMAV_CONTAINER_NAME" HOST_PORT="$CLAMAV_HOST_PORT" \
    "$ROOT_DIR/scripts/podman-clamav.sh" stop >/dev/null 2>&1 || true

  if [[ "$KEEP_ARTIFACTS" != "1" ]]; then
    rm -rf "$ATTACH_DIR" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

mkdir -p "$ROOT_DIR/tmp"
mkdir -p "$ATTACH_DIR"

echo "[1/7] setup postgres (podman): $DB_CONTAINER_NAME (port: $DB_HOST_PORT)"
CONTAINER_NAME="$DB_CONTAINER_NAME" HOST_PORT="$DB_HOST_PORT" \
  "$ROOT_DIR/scripts/podman-poc.sh" stop >/dev/null 2>&1 || true
CONTAINER_NAME="$DB_CONTAINER_NAME" HOST_PORT="$DB_HOST_PORT" \
  "$ROOT_DIR/scripts/podman-poc.sh" db-push

echo "[2/7] start clamd (podman): $CLAMAV_CONTAINER_NAME (port: $CLAMAV_HOST_PORT)"
CONTAINER_NAME="$CLAMAV_CONTAINER_NAME" HOST_PORT="$CLAMAV_HOST_PORT" WAIT_TIMEOUT_SEC=600 \
  "$ROOT_DIR/scripts/podman-clamav.sh" check >/dev/null

echo "[3/7] build backend (if needed)"
if [[ ! -d "$ROOT_DIR/packages/backend/node_modules" ]]; then
  npm install --prefix "$ROOT_DIR/packages/backend"
fi
npm run prisma:generate --prefix "$ROOT_DIR/packages/backend" >/dev/null
npm run build --prefix "$ROOT_DIR/packages/backend" >/dev/null

echo "[4/7] start backend (PORT=$BACKEND_PORT)"
PORT="$BACKEND_PORT" AUTH_MODE=header DATABASE_URL="$DATABASE_URL" \
CHAT_ATTACHMENT_PROVIDER=local CHAT_ATTACHMENT_LOCAL_DIR="$ATTACH_DIR" \
CHAT_ATTACHMENT_AV_PROVIDER=clamav CLAMAV_HOST=127.0.0.1 CLAMAV_PORT="$CLAMAV_HOST_PORT" \
CHAT_EXTERNAL_LLM_PROVIDER=stub \
  node "$ROOT_DIR/packages/backend/dist/index.js" >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
if ! wait_for_url "$BASE_URL/health" "backend"; then
  echo "backend log (tail):" >&2
  tail -n 200 "$BACKEND_LOG" >&2 || true
  exit 1
fi

echo "[5/7] create private group room"
body_file="$(mktemp)"
code=$(post_json "$BASE_URL/chat-rooms" '{"type":"private_group","name":"Smoke AV room"}' "$body_file")
if [[ "$code" != "200" ]]; then
  echo "create room failed: status=$code" >&2
  cat "$body_file" >&2 || true
  exit 1
fi
room_resp="$(cat "$body_file")"
room_id=$(echo "$room_resp" | json_get "id")
require_value "room_id" "$room_id"
echo "room_id=$room_id"

echo "[6/7] post message"
code=$(post_json "$BASE_URL/chat-rooms/$room_id/messages" '{"body":"Smoke message"}' "$body_file")
if [[ "$code" != "200" ]]; then
  echo "post message failed: status=$code" >&2
  cat "$body_file" >&2 || true
  exit 1
fi
message_resp="$(cat "$body_file")"
message_id=$(echo "$message_resp" | json_get "id")
require_value "message_id" "$message_id"
echo "message_id=$message_id"

echo "[7/7] attachment scan cases"
clean_file="$ROOT_DIR/tmp/smoke-chat-clean.txt"
eicar_file="$ROOT_DIR/tmp/smoke-chat-eicar.txt"
cat >"$clean_file" <<'EOF'
hello
EOF
cat >"$eicar_file" <<'EOF'
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
EOF

code=$(upload_file "$BASE_URL/chat-messages/$message_id/attachments" "$clean_file" "$body_file")
echo "upload clean (clamd up): status=$code"
if [[ "$code" != "200" ]]; then
  echo "response:" >&2
  cat "$body_file" >&2 || true
  exit 1
fi

code=$(upload_file "$BASE_URL/chat-messages/$message_id/attachments" "$eicar_file" "$body_file")
echo "upload eicar (clamd up): status=$code"
if [[ "$code" != "422" ]]; then
  echo "response:" >&2
  cat "$body_file" >&2 || true
  exit 1
fi
err_code=$(cat "$body_file" | json_get "error.code" || true)
echo "error_code=$err_code"

echo "stop clamd and expect 503"
CONTAINER_NAME="$CLAMAV_CONTAINER_NAME" HOST_PORT="$CLAMAV_HOST_PORT" \
  "$ROOT_DIR/scripts/podman-clamav.sh" stop >/dev/null
code=$(upload_file "$BASE_URL/chat-messages/$message_id/attachments" "$clean_file" "$body_file")
echo "upload clean (clamd down): status=$code"
if [[ "$code" != "503" ]]; then
  echo "response:" >&2
  cat "$body_file" >&2 || true
  exit 1
fi

rm -f "$body_file"
echo "smoke ok"
