#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="check"
STRICT=0
MIN_MEMORY_MB=1900
MIN_DISK_MB=10240
REPO_DIR="${ERP4_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
PORTS=(80 443 3001 4173 8080 55432)
REQUIRED_COMMANDS=(git curl jq make podman node npm systemctl loginctl)
WARNINGS=0
FAILURES=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--check] [options]

Read-only diagnostics for Sakura VPS hosts before ERP4 bootstrap/deploy.

Options:
  --check                 Run diagnostics only (default)
  --strict                Treat warnings such as bound ports as failures
  --repo-dir DIR          Directory used for disk-space checks (default: current repo)
  --min-memory-mb N       Recommended memory threshold (default: $MIN_MEMORY_MB)
  --min-disk-mb N         Recommended free disk threshold (default: $MIN_DISK_MB)
  --port PORT             Add a TCP port to availability checks; can be repeated
  -h, --help              Show this help message
USAGE
}

record_ok() {
  printf 'OK: %s\n' "$*"
}

record_warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'WARN: %s\n' "$*" >&2
}

record_fail() {
  FAILURES=$((FAILURES + 1))
  printf 'FAIL: %s\n' "$*" >&2
}

check_command() {
  local cmd="$1"
  if ops_command_exists "$cmd"; then
    record_ok "command available: $cmd"
  else
    record_fail "required command not found: $cmd"
  fi
}

check_os() {
  local os_id="unknown" version_id="unknown" pretty="unknown"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
    os_id="${ID:-unknown}"
    version_id="${VERSION_ID:-unknown}"
    pretty="${PRETTY_NAME:-$os_id $version_id}"
  fi
  record_ok "OS: $pretty"
  if [[ "$os_id" != "ubuntu" ]]; then
    record_warn "Ubuntu 24.04 LTS is the documented baseline; current ID is $os_id"
  elif [[ "$version_id" != "24.04" && "$version_id" != "22.04" ]]; then
    record_warn "Ubuntu 24.04 LTS is recommended; current version is $version_id"
  fi
}

check_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|aarch64|arm64)
      record_ok "architecture: $arch"
      ;;
    *)
      record_warn "untested architecture: $arch"
      ;;
  esac
}

check_memory() {
  local mem_kb mem_mb
  if [[ ! -r /proc/meminfo ]]; then
    record_warn 'cannot read /proc/meminfo'
    return
  fi
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  mem_mb=$((mem_kb / 1024))
  if (( mem_mb < MIN_MEMORY_MB )); then
    record_warn "memory is below recommendation: ${mem_mb}MB < ${MIN_MEMORY_MB}MB"
  else
    record_ok "memory: ${mem_mb}MB"
  fi
}

check_disk() {
  local free_mb mount
  if [[ ! -d "$REPO_DIR" ]]; then
    record_warn "repo-dir does not exist yet: $REPO_DIR"
    return
  fi
  free_mb="$(df -Pm "$REPO_DIR" | awk 'NR == 2 {print $4}')"
  mount="$(df -Pm "$REPO_DIR" | awk 'NR == 2 {print $6}')"
  if [[ -z "$free_mb" ]]; then
    record_warn "cannot determine free disk for $REPO_DIR"
  elif (( free_mb < MIN_DISK_MB )); then
    record_warn "free disk is below recommendation on $mount: ${free_mb}MB < ${MIN_DISK_MB}MB"
  else
    record_ok "free disk on $mount: ${free_mb}MB"
  fi
}

check_port() {
  local port="$1" output=""
  if ops_command_exists ss; then
    output="$(ss -ltnH "( sport = :$port )" 2>/dev/null || true)"
  elif ops_command_exists netstat; then
    output="$(netstat -ltn 2>/dev/null | awk -v port="$port" '
      NR > 2 {
        local_address = $4
        local_port = local_address
        sub(/^.*:/, "", local_port)
        if (local_port == port) print
      }
    ' || true)"
  else
    record_warn 'neither ss nor netstat is available; skipping port diagnostics'
    return
  fi

  if [[ -n "$output" ]]; then
    if [[ "$STRICT" -eq 1 ]]; then
      record_fail "TCP $port is already bound"
    else
      record_warn "TCP $port is already bound"
    fi
    printf '%s\n' "$output" >&2
  else
    record_ok "TCP $port is free"
  fi
}

check_linger() {
  local user output
  if ! ops_command_exists loginctl; then
    record_warn 'loginctl not found; cannot check user linger'
    return
  fi
  user="$(id -un)"
  if output="$(loginctl show-user "$user" --property=Linger --value 2>/dev/null)" && [[ "$output" == "yes" ]]; then
    record_ok "loginctl linger enabled for $user"
  else
    record_warn "loginctl enable-linger $user is not enabled or cannot be queried"
  fi
}

check_unprivileged_ports() {
  local value
  if ! ops_command_exists sysctl; then
    record_warn 'sysctl not found; cannot check rootless low-port setting'
    return
  fi
  value="$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || true)"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    record_warn 'cannot read net.ipv4.ip_unprivileged_port_start'
  elif (( value > 80 )); then
    record_warn "rootless Podman cannot bind 80/443 until net.ipv4.ip_unprivileged_port_start is 80 or lower (current: $value)"
  else
    record_ok "net.ipv4.ip_unprivileged_port_start=$value"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      MODE="check"
      shift
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    --repo-dir)
      ops_require_arg "$1" "${2:-}"
      REPO_DIR="$2"
      shift 2
      ;;
    --min-memory-mb)
      ops_require_arg "$1" "${2:-}"
      ops_is_positive_integer "$2" || ops_fail '--min-memory-mb must be a positive integer'
      MIN_MEMORY_MB="$2"
      shift 2
      ;;
    --min-disk-mb)
      ops_require_arg "$1" "${2:-}"
      ops_is_positive_integer "$2" || ops_fail '--min-disk-mb must be a positive integer'
      MIN_DISK_MB="$2"
      shift 2
      ;;
    --port)
      ops_require_arg "$1" "${2:-}"
      [[ "$2" =~ ^[0-9]+$ ]] || ops_fail '--port must be numeric'
      PORTS+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      ops_fail "unknown argument: $1"
      ;;
  esac
done

[[ "$MODE" == "check" ]] || ops_fail 'only --check is supported by this script'

printf '# ERP4 Sakura VPS preflight (%s)\n' "$(ops_timestamp)"
check_os
check_arch
for cmd in "${REQUIRED_COMMANDS[@]}"; do
  check_command "$cmd"
done
check_memory
check_disk
check_linger
check_unprivileged_ports
for port in "${PORTS[@]}"; do
  check_port "$port"
done

printf 'Summary: failures=%s warnings=%s\n' "$FAILURES" "$WARNINGS"
if (( FAILURES > 0 )); then
  exit 1
fi
if [[ "$STRICT" -eq 1 && "$WARNINGS" -gt 0 ]]; then
  exit 1
fi
