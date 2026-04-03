#!/usr/bin/env bash
set -euo pipefail

SYSTEMCTL="${SYSTEMCTL:-systemctl}"
TIMERS=(erp4-config-backup.timer erp4-db-backup.timer erp4-config-prune.timer)

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help    Show this help message and exit
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_systemctl_user() {
  local output
  if output="$("$SYSTEMCTL" --user "$@" 2>&1)"; then
    printf '%s' "$output"
    return 0
  fi
  if grep -Fq 'Failed to connect to bus' <<<"$output"; then
    fail "systemctl --user is unavailable in this session; run 'sudo loginctl enable-linger $(id -un)' and retry from a user session with a systemd bus"
  fi
  printf '%s\n' "$output" >&2
  return 1
}

run_systemctl_user_status() {
  local output rc
  set +e
  output="$("$SYSTEMCTL" --user "$@" 2>&1)"
  rc=$?
  set -e
  if [[ $rc -eq 0 || $rc -eq 3 || $rc -eq 4 ]]; then
    printf '%s' "$output"
    return 0
  fi
  if grep -Fq 'Failed to connect to bus' <<<"$output"; then
    fail "systemctl --user is unavailable in this session; run 'sudo loginctl enable-linger $(id -un)' and retry from a user session with a systemd bus"
  fi
  printf '%s\n' "$output" >&2
  return $rc
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"
run_systemctl_user list-timers "${TIMERS[@]}"
printf '\n'
run_systemctl_user_status status "${TIMERS[@]}"
