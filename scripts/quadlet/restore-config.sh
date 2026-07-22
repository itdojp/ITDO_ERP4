#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
SYSTEMD_USER_TARGET_DIR="${SYSTEMD_USER_TARGET_DIR:-$HOME/.config/systemd/user}"
ARCHIVE=""
OVERWRITE=0
LIST_ONLY=0
SKIP_DAEMON_RELOAD=0
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
NATIVE_UNITS=(
  erp4-migrate.service
  erp4-config-backup.service
  erp4-config-backup.timer
  erp4-db-backup.service
  erp4-db-backup.timer
  erp4-config-prune.service
  erp4-config-prune.timer
  erp4-storage-readiness.service
  erp4-storage-readiness.timer
)

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help             Show this help message and exit
  --archive FILE         Backup archive created by backup-config.sh
  --target-dir DIR       Restore target directory (default: ~/.config/containers/systemd)
  --systemd-user-target-dir DIR
                         Register restored native units in DIR
  --overwrite            Allow restoring over existing files
  --list                 List archive contents and exit
  --skip-daemon-reload   Skip systemctl --user daemon-reload after restoring unit files
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

is_managed_native_unit() {
  local candidate="$1"
  local name
  for name in "${NATIVE_UNITS[@]}"; do
    [[ "$candidate" == "$name" ]] && return 0
  done
  return 1
}

ensure_private_directory() {
  local path="$1"
  if [[ ! -d "$path" ]]; then
    mkdir -p -- "$path"
    chmod 0700 -- "$path"
  fi
}

preflight_native_unit_links() {
  local name source destination current_target
  for name in "${restored_native_units[@]}"; do
    source="$TARGET_DIR/$name"
    destination="$SYSTEMD_USER_TARGET_DIR/$name"
    [[ "$source" != "$destination" ]] || continue
    if [[ -L "$destination" ]]; then
      current_target="$(readlink "$destination")"
      [[ "$current_target" == "$source" ]] || \
        fail "native systemd unit symlink points outside the restore target: $destination -> $current_target"
    elif [[ -e "$destination" ]]; then
      fail "native systemd unit already exists and will not be overwritten: $destination"
    fi
  done
}

register_native_unit_links() {
  local name source destination
  [[ ${#restored_native_units[@]} -gt 0 ]] || return 0
  ensure_private_directory "$SYSTEMD_USER_TARGET_DIR"
  for name in "${restored_native_units[@]}"; do
    source="$TARGET_DIR/$name"
    destination="$SYSTEMD_USER_TARGET_DIR/$name"
    [[ -f "$source" && ! -L "$source" ]] || fail "restored native unit is not a regular file: $source"
    [[ "$source" != "$destination" ]] || continue
    if [[ ! -L "$destination" ]]; then
      ln -s -- "$source" "$destination"
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || fail 'missing argument for --archive'
      ARCHIVE="$2"
      shift 2
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
    --overwrite)
      OVERWRITE=1
      shift
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    --skip-daemon-reload)
      SKIP_DAEMON_RELOAD=1
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

[[ -n "$ARCHIVE" ]] || fail '--archive is required'
[[ -f "$ARCHIVE" ]] || fail "archive not found: $ARCHIVE"
command -v tar >/dev/null 2>&1 || fail 'required command not found: tar'

if ! entries_output="$(tar -tzf "$ARCHIVE")"; then
  fail "archive could not be listed: $ARCHIVE"
fi
mapfile -t entries <<<"$entries_output"
[[ ${#entries[@]} -gt 0 ]] || fail "archive is empty: $ARCHIVE"
if ! entry_details_output="$(tar -tvzf "$ARCHIVE")"; then
  fail "archive metadata could not be verified: $ARCHIVE"
fi
mapfile -t entry_details <<<"$entry_details_output"
[[ ${#entry_details[@]} -eq ${#entries[@]} ]] || fail "archive metadata could not be verified: $ARCHIVE"

requires_daemon_reload=0
restored_native_units=()
for i in "${!entries[@]}"; do
  entry="${entries[$i]}"
  detail="${entry_details[$i]}"
  [[ -n "$entry" ]] || fail "archive contains an empty entry: $ARCHIVE"
  [[ "$entry" != /* ]] || fail "archive contains an absolute path: $entry"
  [[ "$entry" != *'/'* ]] || fail "archive contains nested paths: $entry"
  [[ "$entry" != '.' && "$entry" != '..' ]] || fail "archive contains an invalid entry: $entry"
  [[ "${detail:0:1}" == "-" ]] || fail "archive contains a non-regular entry: $entry"
  if [[ "$entry" =~ \.(container|service|timer|volume|network)$ ]]; then
    requires_daemon_reload=1
  fi
  if is_managed_native_unit "$entry"; then
    restored_native_units+=("$entry")
  fi
done

if [[ "$LIST_ONLY" -eq 1 ]]; then
  printf 'Archive entries:\n'
  printf '  %s\n' "${entries[@]}"
  exit 0
fi

preflight_native_unit_links

if [[ "$OVERWRITE" -eq 0 ]]; then
  collisions=()
  for entry in "${entries[@]}"; do
    if [[ -e "$TARGET_DIR/$entry" || -L "$TARGET_DIR/$entry" ]]; then
      collisions+=("$entry")
    fi
  done
  if [[ ${#collisions[@]} -gt 0 ]]; then
    printf 'ERROR: restore target already has files; rerun with --overwrite\n' >&2
    printf '  %s\n' "${collisions[@]}" >&2
    exit 1
  fi
fi

if [[ "$SKIP_DAEMON_RELOAD" -eq 0 && "$requires_daemon_reload" -eq 1 ]]; then
  command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"
fi

ensure_private_directory "$TARGET_DIR"
tar -C "$TARGET_DIR" --no-same-owner --no-same-permissions -xzf "$ARCHIVE"
register_native_unit_links

if [[ "$SKIP_DAEMON_RELOAD" -eq 0 && "$requires_daemon_reload" -eq 1 ]]; then
  run_daemon_reload
fi

printf 'OK: restored %s into %s\n' "$ARCHIVE" "$TARGET_DIR"
