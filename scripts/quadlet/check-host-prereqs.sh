#!/usr/bin/env bash
set -euo pipefail

SKIP_PORT_CHECK=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --skip-port-check  Skip checking whether TCP 80/443 are already bound
  -h, --help         Show this help message and exit
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
}

require_loginctl_linger() {
  local user linger output
  user="$(id -un)"
  if ! output="$(loginctl show-user "$user" --property=Linger --value 2>&1)"; then
    output="${output//$'\n'/ }"
    fail "failed to query linger state for user $user via loginctl (${output:-unknown loginctl error})"
  fi
  linger="${output//$'\n'/ }"
  [[ "$linger" == "yes" ]] || fail "loginctl enable-linger $user is not enabled"
}

require_unprivileged_port_start() {
  local value
  require_command sysctl
  value="$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || true)"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "failed to read net.ipv4.ip_unprivileged_port_start"
  if (( value > 80 )); then
    fail "net.ipv4.ip_unprivileged_port_start must be 80 or lower for rootless 80/443 binding (current: $value)"
  fi
  printf 'OK: net.ipv4.ip_unprivileged_port_start=%s\n' "$value"
}

port_report() {
  local port="$1"
  local output=""

  if command -v ss >/dev/null 2>&1; then
    output="$(ss -ltnH "( sport = :$port )" 2>/dev/null || true)"
  elif command -v netstat >/dev/null 2>&1; then
    output="$(netstat -ltn 2>/dev/null | awk -v port="$port" '
      NR > 2 {
        local_address = $4
        local_port = local_address
        sub(/^.*:/, "", local_port)
        if (local_port == port) {
          print
        }
      }
    ' || true)"
  else
    fail "required command not found: ss or netstat"
  fi

  if [[ -n "$output" ]]; then
    printf 'ERROR: TCP %s is already bound\n' "$port" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi

  printf 'OK: TCP %s is free\n' "$port"
}

check_port_bindings() {
  local failed=0

  if ! port_report 80; then
    failed=1
  fi
  if ! port_report 443; then
    failed=1
  fi

  return "$failed"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-port-check)
      SKIP_PORT_CHECK=1
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

require_command podman
require_command systemctl
require_command loginctl

require_loginctl_linger
require_unprivileged_port_start

if [[ "$SKIP_PORT_CHECK" -eq 0 ]]; then
  check_port_bindings
fi

printf 'OK: host prerequisites for rootless Podman + Caddy are satisfied\n'
