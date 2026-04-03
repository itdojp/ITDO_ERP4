#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
CADDY_ENV="${CADDY_ENV_FILE:-$TARGET_DIR/erp4-caddy.env}"
CURL_BIN="${CURL:-curl}"
APP_PATH="/"
API_PATH="/healthz"
TIMEOUT_SECONDS=15
RESOLVE_IP=""
SKIP_APP=0
SKIP_API=0
INSECURE=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help            Show this help message and exit
  --target-dir DIR      Set the target directory for generated quadlet files
  --caddy-env FILE      Path to the Caddy environment file
  --app-path PATH       HTTPS path to probe on APP_DOMAIN (default: /)
  --api-path PATH       HTTPS path to probe on API_DOMAIN (default: /healthz)
  --resolve-ip ADDR     Pass curl --resolve for APP_DOMAIN/API_DOMAIN:443:ADDR
                        IPv6 addresses are accepted; brackets are added automatically when missing
  --timeout-seconds N   Per-request timeout in seconds (default: 15)
  --skip-app            Skip APP_DOMAIN probe
  --skip-api            Skip API_DOMAIN probe
  --insecure            Pass -k to curl
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "required file not found: $1"
}

read_env_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    $0 ~ /^[[:space:]]*#/ { next }
    $0 ~ /^[[:space:]]*$/ { next }
    {
      pos = index($0, "=")
      if (pos == 0) next
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
  [[ -n "$value" ]] || fail "$file has missing or empty required key: $key"
  printf '%s\n' "$value"
}

normalize_https_path() {
  local path="${1:-}"
  if [[ -z "$path" ]]; then
    printf '/\n'
  elif [[ "$path" == /* ]]; then
    printf '%s\n' "$path"
  else
    printf '/%s\n' "$path"
  fi
}

normalize_resolve_ip() {
  local addr="${1:-}"
  if [[ -z "$addr" ]]; then
    printf '\n'
  elif [[ "$addr" == \[*\] ]]; then
    printf '%s\n' "$addr"
  elif [[ "$addr" == *:* ]]; then
    printf '[%s]\n' "$addr"
  else
    printf '%s\n' "$addr"
  fi
}

probe_url() {
  local label="$1"
  local domain="$2"
  local path="$3"
  local expect_mode="$4"
  local resolve_addr=""
  path="$(normalize_https_path "$path")"
  local url="https://${domain}${path}"
  local -a args
  local status
  args=(--silent --show-error --output /dev/null --write-out '%{http_code}' --location --max-time "$TIMEOUT_SECONDS")
  if [[ "$INSECURE" -eq 1 ]]; then
    args+=(-k)
  fi
  if [[ -n "$RESOLVE_IP" ]]; then
    resolve_addr="$(normalize_resolve_ip "$RESOLVE_IP")"
    args+=(--resolve "${domain}:443:${resolve_addr}")
  fi
  status="$($CURL_BIN "${args[@]}" "$url")" || fail "$label probe failed: $url"
  case "$expect_mode" in
    2xx-or-3xx)
      [[ "$status" =~ ^[23][0-9][0-9]$ ]] || fail "$label endpoint returned unexpected status ${status}: $url"
      ;;
    200)
      [[ "$status" == "200" ]] || fail "$label endpoint returned unexpected status ${status}: $url"
      ;;
    *)
      fail "unknown expect mode: $expect_mode"
      ;;
  esac
  printf 'OK: %s %s -> %s\n' "$label" "$url" "$status"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --target-dir'
      TARGET_DIR="$2"
      CADDY_ENV="$TARGET_DIR/erp4-caddy.env"
      shift 2
      ;;
    --caddy-env)
      [[ $# -ge 2 ]] || fail 'missing argument for --caddy-env'
      CADDY_ENV="$2"
      shift 2
      ;;
    --app-path)
      [[ $# -ge 2 ]] || fail 'missing argument for --app-path'
      APP_PATH="$2"
      shift 2
      ;;
    --api-path)
      [[ $# -ge 2 ]] || fail 'missing argument for --api-path'
      API_PATH="$2"
      shift 2
      ;;
    --resolve-ip)
      [[ $# -ge 2 ]] || fail 'missing argument for --resolve-ip'
      RESOLVE_IP="$2"
      shift 2
      ;;
    --timeout-seconds)
      [[ $# -ge 2 ]] || fail 'missing argument for --timeout-seconds'
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --skip-app)
      SKIP_APP=1
      shift
      ;;
    --skip-api)
      SKIP_API=1
      shift
      ;;
    --insecure)
      INSECURE=1
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

command -v "$CURL_BIN" >/dev/null 2>&1 || fail "required command not found: $CURL_BIN"
require_file "$CADDY_ENV"
[[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail '--timeout-seconds must be a positive integer'
[[ "$SKIP_APP" -eq 0 || "$SKIP_API" -eq 0 ]] || fail 'at least one of app/api probes must remain enabled'

if [[ "$SKIP_APP" -eq 0 ]]; then
  APP_DOMAIN="$(require_env_key "$CADDY_ENV" APP_DOMAIN)"
  probe_url app "$APP_DOMAIN" "$APP_PATH" 2xx-or-3xx
fi

if [[ "$SKIP_API" -eq 0 ]]; then
  API_DOMAIN="$(require_env_key "$CADDY_ENV" API_DOMAIN)"
  probe_url api "$API_DOMAIN" "$API_PATH" 200
fi
