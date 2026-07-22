#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
BACKUP_AND_CHECK="${BACKUP_AND_CHECK:-$SCRIPT_DIR/backup-and-check.sh}"
BUILD_IMAGES="${BUILD_IMAGES:-$SCRIPT_DIR/build-images.sh}"
INSTALL_UNITS="${INSTALL_UNITS:-$SCRIPT_DIR/install-user-units.sh}"
CHECK_STACK="${CHECK_STACK:-$SCRIPT_DIR/check-stack.sh}"
STATUS_STACK="${STATUS_STACK:-$SCRIPT_DIR/status-stack.sh}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
PODMAN="${PODMAN:-podman}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-erp4-postgres}"
POSTGRES_USER="${POSTGRES_USER:-erp4}"
POSTGRES_READY_TIMEOUT_SECONDS="${POSTGRES_READY_TIMEOUT_SECONDS:-60}"
BACKUP_BEFORE_UPDATE=0
SKIP_BUILD=0
SKIP_INSTALL_UNITS=0
SKIP_STACK_CHECK=0
INCLUDE_PROXY=0
PROFILE="${SAKURA_VPS_PROFILE:-production}"
POSTGRES_UNIT_CHANGED=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --backup-before-update
  --skip-build
  --skip-install-units
  --skip-stack-check
  --profile NAME
  --include-proxy
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_systemctl_user() {
  local output

  if output="$("$SYSTEMCTL" --user "$@" 2>&1)"; then
    [[ -n "$output" ]] && printf '%s\n' "$output"
    return 0
  fi

  if grep -Fq 'Failed to connect to bus' <<<"$output"; then
    fail "systemctl --user failed because the user bus is unavailable; rerun with a user session or run 'sudo loginctl enable-linger $(id -un)'"
  fi

  printf '%s\n' "$output" >&2
  return 1
}

run_build_images() {
  if [[ "$SKIP_BUILD" -eq 1 ]]; then
    return 0
  fi

  "$BUILD_IMAGES"
}

run_install_units() {
  local before after
  if [[ "$SKIP_INSTALL_UNITS" -eq 1 ]]; then
    return 0
  fi

  before="$(postgres_unit_signature)"
  "$INSTALL_UNITS" --profile "$PROFILE"
  after="$(postgres_unit_signature)"
  if [[ "$before" != "$after" ]]; then
    POSTGRES_UNIT_CHANGED=1
  fi
}

postgres_unit_signature() {
  local path="$TARGET_DIR/erp4-postgres.container"
  if [[ -L "$path" ]]; then
    printf 'link:%s\n' "$(readlink "$path")"
  elif [[ -f "$path" ]]; then
    sha256sum "$path" | awk '{print "file:" $1}'
  else
    printf '%s\n' absent
  fi
}

wait_postgres_ready() {
  local deadline=$((SECONDS + POSTGRES_READY_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if "$PODMAN" exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" -t 1 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "PostgreSQL did not become ready within ${POSTGRES_READY_TIMEOUT_SECONDS}s after unit change"
}

run_backup() {
  local backup_args=(
    --include-units
  )

  if [[ "$BACKUP_BEFORE_UPDATE" -eq 0 ]]; then
    return 0
  fi

  if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
    backup_args+=(--include-proxy)
  fi

  "$BACKUP_AND_CHECK" "${backup_args[@]}"
}

run_stack_check() {
  if [[ "$SKIP_STACK_CHECK" -eq 1 ]]; then
    return 0
  fi

  "$CHECK_STACK"

  if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
    "$STATUS_STACK" --include-proxy
  fi
}

restart_unit() {
  local unit="$1"
  run_systemctl_user restart "$unit"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-before-update)
      BACKUP_BEFORE_UPDATE=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-install-units)
      SKIP_INSTALL_UNITS=1
      shift
      ;;
    --skip-stack-check)
      SKIP_STACK_CHECK=1
      shift
      ;;
    --profile)
      [[ $# -ge 2 ]] || fail 'missing argument for --profile'
      PROFILE="$2"
      shift 2
      ;;
    --include-proxy)
      INCLUDE_PROXY=1
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
  production|private-smoke|https-trial) ;;
  *) fail "unknown profile: $PROFILE" ;;
esac
[[ "$POSTGRES_READY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail 'POSTGRES_READY_TIMEOUT_SECONDS must be a positive integer'
if [[ "$PROFILE" == "private-smoke" && "$INCLUDE_PROXY" -eq 1 ]]; then
  fail 'private-smoke must not include proxy'
fi
if [[ "$PROFILE" == "https-trial" && "$INCLUDE_PROXY" -eq 0 ]]; then
  fail 'https-trial requires --include-proxy'
fi

if [[ "$BACKUP_BEFORE_UPDATE" -eq 1 ]]; then
  [[ -x "$BACKUP_AND_CHECK" ]] || fail "backup command is not executable: $BACKUP_AND_CHECK"
  run_backup
fi
command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  [[ -x "$BUILD_IMAGES" ]] || fail "build command is not executable: $BUILD_IMAGES"
fi
if [[ "$SKIP_INSTALL_UNITS" -eq 0 ]]; then
  [[ -x "$INSTALL_UNITS" ]] || fail "install command is not executable: $INSTALL_UNITS"
fi
if [[ "$SKIP_STACK_CHECK" -eq 0 ]]; then
  [[ -x "$CHECK_STACK" ]] || fail "check command is not executable: $CHECK_STACK"
fi
if [[ "$SKIP_STACK_CHECK" -eq 0 && "$INCLUDE_PROXY" -eq 1 ]]; then
  [[ -x "$STATUS_STACK" ]] || fail "status command is not executable: $STATUS_STACK"
fi

run_build_images
run_install_units

if [[ "$POSTGRES_UNIT_CHANGED" -eq 1 ]]; then
  command -v "$PODMAN" >/dev/null 2>&1 || fail "required command not found: $PODMAN"
  restart_unit erp4-postgres.service
  wait_postgres_ready
fi
restart_unit erp4-migrate.service
restart_unit erp4-backend.service
restart_unit erp4-frontend.service
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  restart_unit erp4-caddy.service
fi

run_stack_check
