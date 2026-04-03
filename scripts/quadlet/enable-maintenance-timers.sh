#!/usr/bin/env bash
set -euo pipefail

SYSTEMCTL="${SYSTEMCTL:-systemctl}"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
SKIP_STATUS=0
TIMERS=(erp4-config-backup.timer erp4-db-backup.timer erp4-config-prune.timer)

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help         Show this help message and exit
  --target-dir DIR   Override Quadlet target directory for validation
  --skip-status      Do not print timer status after enabling
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --target-dir'
      TARGET_DIR="$2"
      shift 2
      ;;
    --skip-status)
      SKIP_STATUS=1
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

command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"
[[ -f "$TARGET_DIR/erp4-maintenance.env" ]] || fail "required file not found: $TARGET_DIR/erp4-maintenance.env"
[[ -f "$TARGET_DIR/erp4-config-backup.timer" ]] || fail "required file not found: $TARGET_DIR/erp4-config-backup.timer"
[[ -f "$TARGET_DIR/erp4-db-backup.timer" ]] || fail "required file not found: $TARGET_DIR/erp4-db-backup.timer"
[[ -f "$TARGET_DIR/erp4-config-prune.timer" ]] || fail "required file not found: $TARGET_DIR/erp4-config-prune.timer"
[[ -f "$TARGET_DIR/erp4-config-backup.service" ]] || fail "required file not found: $TARGET_DIR/erp4-config-backup.service"
[[ -f "$TARGET_DIR/erp4-db-backup.service" ]] || fail "required file not found: $TARGET_DIR/erp4-db-backup.service"
[[ -f "$TARGET_DIR/erp4-config-prune.service" ]] || fail "required file not found: $TARGET_DIR/erp4-config-prune.service"

run_systemctl_user daemon-reload >/dev/null
run_systemctl_user enable --now "${TIMERS[@]}" >/dev/null
printf 'OK: enabled %s\n' "${TIMERS[*]}"

if [[ "$SKIP_STATUS" -eq 1 ]]; then
  exit 0
fi

run_systemctl_user list-timers "${TIMERS[@]}"
