#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
FRONTEND_BUILD_ENV="${FRONTEND_BUILD_ENV_FILE:-$ROOT_DIR/deploy/quadlet/env/erp4-frontend-build.env}"
FRONTEND_BUILD_ENV_EXPLICIT=0
SKIP_RUNTIME=0
PROFILE="${SAKURA_VPS_PROFILE:-production}"

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
Usage: $(basename "$0") [--profile production|private-smoke|https-trial] [--target-dir DIR] [--frontend-build-env FILE] [--skip-runtime]

Profiles:
  production      Existing production-like Quadlet validation (default)
  private-smoke   Non-public stack smoke without Caddy, host publishing, or real OAuth
  https-trial     Trial FQDN + HTTPS + jwt_bff validation with Caddy
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

require_env_value() {
  local file="$1"
  local key="$2"
  local expected="$3"
  local value
  value="$(read_env_value "$file" "$key")"
  [[ "$value" == "$expected" ]] || fail "$file requires $key=$expected for profile $PROFILE"
}

require_env_lower_value() {
  local file="$1"
  local key="$2"
  local expected="$3"
  local value
  value="$(read_env_value "$file" "$key")"
  value="${value,,}"
  [[ "$value" == "$expected" ]] || fail "$file requires $key=$expected for profile $PROFILE"
}

require_https_url() {
  local file="$1"
  local key="$2"
  local value
  value="$(read_env_value "$file" "$key")"
  [[ "$value" == https://* ]] || fail "$file requires HTTPS $key for profile $PROFILE"
}

trim_whitespace() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# forbid_http_url_any splits on commas so that multi-value keys like
# ALLOWED_ORIGINS are checked entry by entry.
forbid_http_url_any() {
  local file="$1"
  local key="$2"
  local value origin
  value="$(read_env_value "$file" "$key")"
  local IFS=,
  read -ra origins <<< "$value"
  for origin in "${origins[@]}"; do
    origin="$(trim_whitespace "$origin")"
    [[ -z "$origin" ]] && continue
    [[ "$origin" != http://* ]] || fail "$file must not use HTTP in $key for profile $PROFILE"
  done
}

container_file() {
  local name="$1"
  printf '%s/%s.container\n' "$TARGET_DIR" "$name"
}

has_publish_port() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  grep -Eq '^[[:space:]]*PublishPort[[:space:]]*=' "$file"
}

require_no_publish_port() {
  local file="$1"
  local label="$2"
  [[ -f "$file" ]] || return 0
  if has_publish_port "$file"; then
    fail "$label must not publish host ports for profile $PROFILE"
  fi
}

has_host_publish_port() {
  local file="$1"
  local expected_host_port="$2"
  awk -v expected="$expected_host_port" '
    /^[[:space:]]*PublishPort[[:space:]]*=/ {
      value = $0
      sub(/^[^=]*=/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      n = split(value, parts, ":")
      if (n < 2) {
        next
      }
      host_port = parts[n - 1]
      sub(/\/.*$/, "", host_port)
      if (host_port == expected) {
        found = 1
      }
    }
    END { exit found ? 0 : 1 }
  ' "$file"
}

require_host_publish_port() {
  local file="$1"
  local expected_host_port="$2"
  local label="$3"
  [[ -f "$file" ]] || fail "required container file not found for profile $PROFILE: $file"
  has_host_publish_port "$file" "$expected_host_port" || fail "$label must publish host port $expected_host_port for profile $PROFILE"
}

check_http_cookie_flag() {
  local auth_mode node_env origin redirect secure
  auth_mode="$(read_env_value "$BACKEND_ENV" AUTH_MODE)"
  node_env="$(read_env_value "$BACKEND_ENV" NODE_ENV)"
  origin="$(read_env_value "$BACKEND_ENV" AUTH_FRONTEND_ORIGIN)"
  redirect="$(read_env_value "$BACKEND_ENV" GOOGLE_OIDC_REDIRECT_URI)"
  secure="$(read_env_value "$BACKEND_ENV" AUTH_SESSION_COOKIE_SECURE)"
  auth_mode="${auth_mode,,}"
  node_env="${node_env,,}"
  secure="${secure,,}"

  if [[ "$node_env" == "production" && "$auth_mode" == "jwt_bff" ]]; then
    if [[ "$secure" == "false" || "$secure" == "0" ]]; then
      fail "AUTH_SESSION_COOKIE_SECURE must not be false for production jwt_bff"
    fi
    if [[ "$origin" == http://* || "$redirect" == http://* ]]; then
      fail "production jwt_bff requires HTTPS AUTH_FRONTEND_ORIGIN and GOOGLE_OIDC_REDIRECT_URI"
    fi
  fi

  if [[ "$origin" == http://* || "$redirect" == http://* ]]; then
    if [[ "$secure" != "false" && "$secure" != "0" ]]; then
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

require_common_runtime_env() {
  for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
    require_env_key "$POSTGRES_ENV" "$key"
  done

  for key in DATABASE_URL PORT NODE_ENV AUTH_MODE ALLOWED_ORIGINS MAIL_TRANSPORT PDF_PROVIDER PDF_STORAGE_DIR PDF_BASE_URL EVIDENCE_ARCHIVE_PROVIDER EVIDENCE_ARCHIVE_LOCAL_DIR CHAT_ATTACHMENT_PROVIDER CHAT_ATTACHMENT_LOCAL_DIR REPORT_STORAGE_DIR; do
    require_env_key "$BACKEND_ENV" "$key"
  done
}

check_production_profile() {
  for key in GOOGLE_OIDC_CLIENT_SECRET GOOGLE_OIDC_REDIRECT_URI AUTH_FRONTEND_ORIGIN AUTH_SESSION_COOKIE_SECURE; do
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
}

check_private_smoke_profile() {
  require_env_value "$BACKEND_ENV" SAKURA_VPS_PROFILE private-smoke
  require_env_lower_value "$BACKEND_ENV" MAIL_TRANSPORT stub
  require_env_lower_value "$BACKEND_ENV" PDF_PROVIDER local
  require_env_lower_value "$BACKEND_ENV" EVIDENCE_ARCHIVE_PROVIDER local
  require_env_lower_value "$BACKEND_ENV" CHAT_ATTACHMENT_PROVIDER local

  local auth_mode node_env header_fallback
  auth_mode="$(read_env_value "$BACKEND_ENV" AUTH_MODE)"
  node_env="$(read_env_value "$BACKEND_ENV" NODE_ENV)"
  header_fallback="$(read_env_value "$BACKEND_ENV" AUTH_ALLOW_HEADER_FALLBACK_IN_PROD)"
  auth_mode="${auth_mode,,}"
  node_env="${node_env,,}"
  header_fallback="${header_fallback,,}"

  if [[ "$node_env" == "production" && "$auth_mode" == "header" ]]; then
    fail "private-smoke must not use production header auth"
  fi
  if [[ "$header_fallback" == "true" || "$header_fallback" == "1" ]]; then
    fail "private-smoke must not enable AUTH_ALLOW_HEADER_FALLBACK_IN_PROD"
  fi

  for name in erp4-backend erp4-frontend erp4-postgres; do
    require_no_publish_port "$(container_file "$name")" "$name"
  done
  if [[ -f "$(container_file erp4-caddy)" || -f "$TARGET_DIR/erp4-caddy.env" || -f "$TARGET_DIR/erp4-caddy.Caddyfile" ]]; then
    fail "private-smoke must not install or start Caddy/proxy files"
  fi
}

check_https_trial_profile() {
  require_env_value "$BACKEND_ENV" SAKURA_VPS_PROFILE https-trial
  require_env_lower_value "$BACKEND_ENV" NODE_ENV production
  require_env_lower_value "$BACKEND_ENV" AUTH_MODE jwt_bff
  require_env_lower_value "$BACKEND_ENV" AUTH_SESSION_COOKIE_SECURE true
  require_env_lower_value "$BACKEND_ENV" MAIL_TRANSPORT stub
  require_env_lower_value "$BACKEND_ENV" PDF_PROVIDER local
  require_env_lower_value "$BACKEND_ENV" EVIDENCE_ARCHIVE_PROVIDER local
  require_env_lower_value "$BACKEND_ENV" CHAT_ATTACHMENT_PROVIDER local

  for key in JWT_ISSUER JWT_AUDIENCE GOOGLE_OIDC_CLIENT_SECRET GOOGLE_OIDC_REDIRECT_URI AUTH_FRONTEND_ORIGIN AUTH_SESSION_COOKIE_SECURE; do
    require_env_key "$BACKEND_ENV" "$key"
  done
  if [[ -z "$(read_env_value "$BACKEND_ENV" JWT_PUBLIC_KEY)" && -z "$(read_env_value "$BACKEND_ENV" JWT_JWKS_URL)" ]]; then
    fail "$BACKEND_ENV requires JWT_PUBLIC_KEY or JWT_JWKS_URL when AUTH_MODE=jwt_bff"
  fi
  require_https_url "$BACKEND_ENV" AUTH_FRONTEND_ORIGIN
  require_https_url "$BACKEND_ENV" GOOGLE_OIDC_REDIRECT_URI
  forbid_http_url_any "$BACKEND_ENV" ALLOWED_ORIGINS

  require_file "$TARGET_DIR/erp4-caddy.env"
  for key in APP_DOMAIN API_DOMAIN ACME_EMAIL; do
    require_env_key "$TARGET_DIR/erp4-caddy.env" "$key"
  done
  require_host_publish_port "$(container_file erp4-caddy)" 80 erp4-caddy
  require_host_publish_port "$(container_file erp4-caddy)" 443 erp4-caddy

  if [[ -f "$FRONTEND_BUILD_ENV" ]]; then
    require_https_url "$FRONTEND_BUILD_ENV" VITE_API_BASE
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile|--profile=*)
      if [[ "$1" == "--profile" ]]; then
        [[ $# -ge 2 ]] || fail "--profile requires production, private-smoke, or https-trial"
        PROFILE="$2"
        shift 2
      else
        PROFILE="${1#--profile=}"
        [[ -n "$PROFILE" ]] || fail "--profile requires production, private-smoke, or https-trial"
        shift
      fi
      ;;
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

case "$PROFILE" in
  production|private-smoke|https-trial)
    ;;
  *)
    fail "unknown profile: $PROFILE"
    ;;
esac

POSTGRES_ENV="$TARGET_DIR/erp4-postgres.env"
BACKEND_ENV="$TARGET_DIR/erp4-backend.env"

if [[ "$SKIP_RUNTIME" -eq 0 ]]; then
  require_file "$POSTGRES_ENV"
  require_file "$BACKEND_ENV"

  require_common_runtime_env
  case "$PROFILE" in
    production)
      check_production_profile
      ;;
    private-smoke)
      check_private_smoke_profile
      ;;
    https-trial)
      check_https_trial_profile
      ;;
  esac
  check_linger
fi

if [[ "$FRONTEND_BUILD_ENV_EXPLICIT" -eq 1 || "$SKIP_RUNTIME" -eq 1 ]]; then
  require_file "$FRONTEND_BUILD_ENV"
fi

if [[ -f "$FRONTEND_BUILD_ENV" ]]; then
  require_env_key "$FRONTEND_BUILD_ENV" VITE_API_BASE
fi

printf 'OK: Quadlet env validation passed'
printf ' profile=%s' "$PROFILE"
if [[ "$SKIP_RUNTIME" -eq 0 ]]; then
  printf ' for %s' "$TARGET_DIR"
fi
printf '\n'
