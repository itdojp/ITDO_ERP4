#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DISABLE_STACK="${DISABLE_STACK:-$ROOT_DIR/scripts/quadlet/disable-stack.sh}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
SYSTEMD_USER_TARGET_DIR="${SYSTEMD_USER_TARGET_DIR:-$HOME/.config/systemd/user}"
INCLUDE_PROXY=0
PURGE_CONFIG=0
REMOVE_EMPTY_TARGET_DIR=0

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help             Show this help message and exit
  --include-proxy        Uninstall erp4-caddy.service related files as well
  --target-dir DIR       Set the target directory for generated quadlet files
  --systemd-user-target-dir DIR
                         Set the native systemd user unit directory
  --purge-config         Also remove env/config files from the target directory
  --remove-empty-dir     Remove the target directory if it becomes empty
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run_daemon_reload() {
  local output
  if output="$("$SYSTEMCTL" --user daemon-reload 2>&1)"; then
    return 0
  fi
  if grep -Fq 'Failed to connect to bus' <<<"$output"; then
    fail "systemctl --user failed because the user bus is unavailable; log in with a user session or run 'sudo loginctl enable-linger $(id -un)'"
  fi
  printf '%s\n' "$output" >&2
  return 1
}

remove_file_if_exists() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    rm -f "$path"
    printf 'removed %s\n' "$path"
  fi
}

remove_managed_native_link() {
  local name="$1"
  local path="$SYSTEMD_USER_TARGET_DIR/$name"
  local expected="$TARGET_DIR/$name"
  if [[ -L "$path" ]]; then
    local current_target
    current_target="$(readlink "$path")"
    if [[ "$current_target" == "$expected" ]]; then
      rm -f "$path"
      printf 'removed %s\n' "$path"
    else
      printf 'WARN: preserved unmanaged native systemd unit symlink %s -> %s\n' "$path" "$current_target" >&2
    fi
  elif [[ -e "$path" ]]; then
    printf 'WARN: preserved unmanaged native systemd unit %s\n' "$path" >&2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-proxy)
      INCLUDE_PROXY=1
      shift
      ;;
    --target-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --target-dir'
      TARGET_DIR="$2"
      shift 2
      ;;
    --systemd-user-target-dir)
      [[ $# -ge 2 ]] || fail 'missing argument for --systemd-user-target-dir'
      SYSTEMD_USER_TARGET_DIR="$2"
      shift 2
      ;;
    --purge-config)
      PURGE_CONFIG=1
      shift
      ;;
    --remove-empty-dir)
      REMOVE_EMPTY_TARGET_DIR=1
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

[[ -x "$DISABLE_STACK" ]] || fail "required executable not found: $DISABLE_STACK"
[[ -d "$TARGET_DIR" ]] || fail "target directory not found: $TARGET_DIR"
command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"

if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  "$DISABLE_STACK" --include-proxy
else
  "$DISABLE_STACK"
fi

remove_managed_native_link erp4-migrate.service

for name in \
  erp4.network \
  erp4-postgres.volume \
  erp4-backend-data.volume \
  erp4-postgres.container \
  erp4-migrate.service \
  erp4-backend.container \
  erp4-frontend.container; do
  remove_file_if_exists "$TARGET_DIR/$name"
done

if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  for name in \
    erp4-caddy-data.volume \
    erp4-caddy-config.volume \
    erp4-caddy.container; do
    remove_file_if_exists "$TARGET_DIR/$name"
  done
fi

if [[ "$PURGE_CONFIG" -eq 1 ]]; then
  for name in erp4-postgres.env erp4-backend.env erp4-frontend-build.env; do
    remove_file_if_exists "$TARGET_DIR/$name"
  done
  if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
    for name in erp4-caddy.env erp4-caddy.Caddyfile; do
      remove_file_if_exists "$TARGET_DIR/$name"
    done
  fi
fi

run_daemon_reload

if [[ "$REMOVE_EMPTY_TARGET_DIR" -eq 1 ]] && [[ -d "$TARGET_DIR" ]] && [[ -z "$(find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  rmdir "$TARGET_DIR"
  printf 'removed %s\n' "$TARGET_DIR"
fi

printf 'OK: Quadlet stack uninstalled from %s\n' "$TARGET_DIR"
