#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTORE_LATEST="${RESTORE_LATEST:-$SCRIPT_DIR/restore-latest.sh}"
RESTART_STACK="${RESTART_STACK:-$SCRIPT_DIR/restart-stack.sh}"
BACKUP_DIR="${QUADLET_BACKUP_DIR:-$HOME/.local/share/erp4/quadlet-backups}"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
INCLUDE_PROXY=0
PRINT_ARCHIVE=0
SKIP_RESTART=0
SKIP_DAEMON_RELOAD=0
SKIP_ENV_CHECK=0
SKIP_STACK_CHECK=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help             Show this help message and exit
  --backup-dir DIR       Directory that contains backup archives
  --target-dir DIR       Restore target directory (default: ~/.config/containers/systemd)
  --include-proxy        Restart erp4-caddy.service after restore
  --print-archive        Print the selected archive path before restore
  --skip-daemon-reload   Pass through to restore-latest.sh
  --skip-restart         Restore config only; do not restart the stack
  --skip-env-check       Pass through to restart-stack.sh
  --skip-build-env-check Deprecated alias for --skip-env-check
  --skip-stack-check     Pass through to restart-stack.sh
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --backup-dir'
      BACKUP_DIR="$2"
      shift 2
      ;;
    --target-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --target-dir'
      TARGET_DIR="$2"
      shift 2
      ;;
    --include-proxy)
      INCLUDE_PROXY=1
      shift
      ;;
    --print-archive)
      PRINT_ARCHIVE=1
      shift
      ;;
    --skip-daemon-reload)
      SKIP_DAEMON_RELOAD=1
      shift
      ;;
    --skip-restart)
      SKIP_RESTART=1
      shift
      ;;
    --skip-env-check|--skip-build-env-check)
      SKIP_ENV_CHECK=1
      shift
      ;;
    --skip-stack-check)
      SKIP_STACK_CHECK=1
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

[[ -x "$RESTORE_LATEST" ]] || fail "restore command is not executable: $RESTORE_LATEST"

restore_args=(
  --backup-dir "$BACKUP_DIR"
  --target-dir "$TARGET_DIR"
  --overwrite
)
if [[ "$PRINT_ARCHIVE" -eq 1 ]]; then
  restore_args+=(--print-archive)
fi
if [[ "$SKIP_DAEMON_RELOAD" -eq 1 ]]; then
  restore_args+=(--skip-daemon-reload)
fi

"$RESTORE_LATEST" "${restore_args[@]}"

if [[ "$SKIP_RESTART" -eq 1 ]]; then
  printf 'OK: latest backup restored without restarting the stack\n'
  exit 0
fi

[[ -x "$RESTART_STACK" ]] || fail "restart command is not executable: $RESTART_STACK"

restart_args=()
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  restart_args+=(--include-proxy)
fi
if [[ "$SKIP_ENV_CHECK" -eq 1 ]]; then
  restart_args+=(--skip-env-check)
fi
if [[ "$SKIP_STACK_CHECK" -eq 1 ]]; then
  restart_args+=(--skip-stack-check)
fi

"$RESTART_STACK" "${restart_args[@]}"

printf 'OK: latest backup restored and Quadlet stack restarted\n'
