#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
FRONTEND_BUILD_ENV="${FRONTEND_BUILD_ENV_FILE:-$ROOT_DIR/deploy/quadlet/env/erp4-frontend-build.env}"
FRONTEND_BUILD_ENV_EXPLICIT=0
SKIP_RUNTIME=0

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

require_file() {
  [[ -f "$1" ]] || fail "required file not found: $1"
}

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--target-dir DIR] [--frontend-build-env FILE] [--skip-runtime]
USAGE
}

read_env_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    $0 ~ /^[[:space:]]*#/ { next }
    $0 ~ /^[[:space:]]*$/ { next }
    {
      pos = index($0, "=")
      if (pos == 0) {
        next
      }
      k = substr($0, 1, pos - 1)
      sub(/^[[:space:]]+/, "", k)
      sub(/[[:space:]]+$/, "", k)
      if (k == key) {
        v = substr($0, pos + 1)
        sub(/^[[:space:]]+/, "", v)
        sub(/[[:space:]]+$/, "", v)
        gsub(/^"|"$/, "", v)
        print v
        exit
      }
    }
  ' "$file"
}

require_env_key() {
  local file="$1"
  local key="$2"
  local value
  value="$(read_env_value "$file" "$key")"
  [[ -n "$value" ]] || fail "$file is missing required key: $key"
}

check_http_cookie_flag() {
  local origin redirect secure
  origin="$(read_env_value "$BACKEND_ENV" AUTH_FRONTEND_ORIGIN)"
  redirect="$(read_env_value "$BACKEND_ENV" GOOGLE_OIDC_REDIRECT_URI)"
  secure="$(read_env_value "$BACKEND_ENV" AUTH_SESSION_COOKIE_SECURE)"

  if [[ "$origin" == http://* || "$redirect" == http://* ]]; then
    if [[ "$secure" != "false" ]]; then
      warn "AUTH_SESSION_COOKIE_SECURE should be false for plain HTTP trial endpoints"
    fi
  fi
}

check_linger() {
  if command -v loginctl >/dev/null 2>&1; then
    if ! loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null | grep -qx 'yes'; then
      warn "loginctl enable-linger $(id -un) is not enabled; user services may not survive logout"
    fi
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir|--target-dir=*)
      if [[ "$1" == "--target-dir" ]]; then
        [[ $# -ge 2 ]] || fail "--target-dir requires a directory path argument"
        TARGET_DIR="$2"
        shift 2
      else
        TARGET_DIR="${1#--target-dir=}"
        [[ -n "$TARGET_DIR" ]] || fail "--target-dir requires a directory path argument"
        shift
      fi
      ;;
    --frontend-build-env|--frontend-build-env=*)
      FRONTEND_BUILD_ENV_EXPLICIT=1
      if [[ "$1" == "--frontend-build-env" ]]; then
        [[ $# -ge 2 ]] || fail "--frontend-build-env requires a file path argument"
        FRONTEND_BUILD_ENV="$2"
        shift 2
      else
        FRONTEND_BUILD_ENV="${1#--frontend-build-env=}"
        [[ -n "$FRONTEND_BUILD_ENV" ]] || fail "--frontend-build-env requires a file path argument"
        shift
      fi
      ;;
    --skip-runtime)
      SKIP_RUNTIME=1
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

POSTGRES_ENV="$TARGET_DIR/erp4-postgres.env"
BACKEND_ENV="$TARGET_DIR/erp4-backend.env"

if [[ "$SKIP_RUNTIME" -eq 0 ]]; then
  require_file "$POSTGRES_ENV"
  require_file "$BACKEND_ENV"

  for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
    require_env_key "$POSTGRES_ENV" "$key"
  done

  for key in DATABASE_URL PORT NODE_ENV AUTH_MODE ALLOWED_ORIGINS GOOGLE_OIDC_CLIENT_SECRET GOOGLE_OIDC_REDIRECT_URI AUTH_FRONTEND_ORIGIN AUTH_SESSION_COOKIE_SECURE MAIL_TRANSPORT PDF_PROVIDER PDF_STORAGE_DIR PDF_BASE_URL EVIDENCE_ARCHIVE_PROVIDER EVIDENCE_ARCHIVE_LOCAL_DIR CHAT_ATTACHMENT_PROVIDER CHAT_ATTACHMENT_LOCAL_DIR REPORT_STORAGE_DIR; do
    require_env_key "$BACKEND_ENV" "$key"
  done

  AUTH_MODE_VALUE="$(read_env_value "$BACKEND_ENV" AUTH_MODE)"
  case "$AUTH_MODE_VALUE" in
    jwt_bff)
      require_env_key "$BACKEND_ENV" JWT_ISSUER
      require_env_key "$BACKEND_ENV" JWT_AUDIENCE
      if [[ -z "$(read_env_value "$BACKEND_ENV" JWT_PUBLIC_KEY)" && -z "$(read_env_value "$BACKEND_ENV" JWT_JWKS_URL)" ]]; then
        fail "$BACKEND_ENV requires JWT_PUBLIC_KEY or JWT_JWKS_URL when AUTH_MODE=jwt_bff"
      fi
      ;;
    *)
      warn "AUTH_MODE=$AUTH_MODE_VALUE is outside the tested Quadlet guide scope; expected jwt_bff"
      ;;
  esac

  check_http_cookie_flag
  check_linger
fi

if [[ "$FRONTEND_BUILD_ENV_EXPLICIT" -eq 1 || "$SKIP_RUNTIME" -eq 1 ]]; then
  require_file "$FRONTEND_BUILD_ENV"
fi

if [[ -f "$FRONTEND_BUILD_ENV" ]]; then
  require_env_key "$FRONTEND_BUILD_ENV" VITE_API_BASE
fi

printf 'OK: Quadlet env validation passed'
if [[ "$SKIP_RUNTIME" -eq 0 ]]; then
  printf ' for %s' "$TARGET_DIR"
fi
printf '\n'
