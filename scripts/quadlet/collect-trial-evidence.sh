#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_BASE_DIR="${OUTPUT_BASE_DIR:-$ROOT_DIR/tmp}"
LINES=100
INCLUDE_PROXY=0
SKIP_HTTPS=0
RESOLVE_IP=""
INSECURE=0
STATUS_STACK="${STATUS_STACK:-$ROOT_DIR/scripts/quadlet/status-stack.sh}"
LOGS_STACK="${LOGS_STACK:-$ROOT_DIR/scripts/quadlet/logs-stack.sh}"
CHECK_HTTPS="${CHECK_HTTPS:-$ROOT_DIR/scripts/quadlet/check-https.sh}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR=""

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --output-dir DIR   Write evidence files under DIR (default: tmp/sakura-vps-trial-<timestamp>)
  --lines N          Pass N to logs-stack.sh (default: 100)
  --include-proxy    Include proxy-aware status/log capture and HTTPS probe
  --resolve-ip ADDR  Pass through to check-https.sh when --include-proxy is set
  --insecure         Pass through to check-https.sh when --include-proxy is set
  --skip-https       Skip check-https.sh even when --include-proxy is set
  -h, --help         Show this help and exit
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

ensure_non_negative_integer() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]] || fail '--lines must be a non-negative integer'
}

run_and_capture() {
  local file="$1"
  shift
  printf '==> %s\n' "$*"
  "$@" >"$file" 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --output-dir'
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --lines)
      [[ $# -ge 2 ]] || fail 'missing argument for --lines'
      LINES="$2"
      shift 2
      ;;
    --include-proxy)
      INCLUDE_PROXY=1
      shift
      ;;
    --resolve-ip)
      [[ $# -ge 2 ]] || fail 'missing argument for --resolve-ip'
      RESOLVE_IP="$2"
      shift 2
      ;;
    --insecure)
      INSECURE=1
      shift
      ;;
    --skip-https)
      SKIP_HTTPS=1
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

ensure_non_negative_integer "$LINES"
[[ -x "$STATUS_STACK" ]] || fail "helper is not executable: $STATUS_STACK"
[[ -x "$LOGS_STACK" ]] || fail "helper is not executable: $LOGS_STACK"
if [[ "$INCLUDE_PROXY" -eq 1 && "$SKIP_HTTPS" -eq 0 ]]; then
  [[ -x "$CHECK_HTTPS" ]] || fail "helper is not executable: $CHECK_HTTPS"
fi
if [[ "$INCLUDE_PROXY" -eq 0 && ( -n "$RESOLVE_IP" || "$INSECURE" -eq 1 ) ]]; then
  fail '--resolve-ip and --insecure require --include-proxy'
fi
command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$OUTPUT_BASE_DIR/sakura-vps-trial-$TIMESTAMP"
fi
mkdir -p "$OUTPUT_DIR"

META_FILE="$OUTPUT_DIR/meta.txt"
STATUS_FILE="$OUTPUT_DIR/status-stack.txt"
LOGS_FILE="$OUTPUT_DIR/logs-stack.txt"
TIMERS_FILE="$OUTPUT_DIR/list-timers.txt"
HTTPS_FILE="$OUTPUT_DIR/check-https.txt"

{
  printf 'collected_at=%s\n' "$(date -Is)"
  printf 'host=%s\n' "$(hostname)"
  printf 'repo_dir=%s\n' "$ROOT_DIR"
  printf 'git_commit=%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || printf 'unknown')"
  printf 'include_proxy=%s\n' "$INCLUDE_PROXY"
  printf 'lines=%s\n' "$LINES"
} >"$META_FILE"

status_cmd=("$STATUS_STACK")
logs_cmd=("$LOGS_STACK" --lines "$LINES")
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  status_cmd+=(--include-proxy)
  logs_cmd+=(--include-proxy)
fi
run_and_capture "$STATUS_FILE" "${status_cmd[@]}"
run_and_capture "$LOGS_FILE" "${logs_cmd[@]}"
run_and_capture "$TIMERS_FILE" "$SYSTEMCTL" --user list-timers 'erp4-*'

if [[ "$INCLUDE_PROXY" -eq 1 && "$SKIP_HTTPS" -eq 0 ]]; then
  https_cmd=("$CHECK_HTTPS")
  if [[ -n "$RESOLVE_IP" ]]; then
    https_cmd+=(--resolve-ip "$RESOLVE_IP")
  fi
  if [[ "$INSECURE" -eq 1 ]]; then
    https_cmd+=(--insecure)
  fi
  run_and_capture "$HTTPS_FILE" "${https_cmd[@]}"
fi

printf 'OK: trial evidence collected under %s\n' "$OUTPUT_DIR"
