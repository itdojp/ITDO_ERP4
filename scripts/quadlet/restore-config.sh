#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
ARCHIVE=""
OVERWRITE=0
LIST_ONLY=0
SKIP_DAEMON_RELOAD=0
SYSTEMCTL="${SYSTEMCTL:-systemctl}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  -h, --help             Show this help message and exit
  --archive FILE         Backup archive created by backup-config.sh
  --target-dir DIR       Restore target directory (default: ~/.config/containers/systemd)
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
  if output="$($SYSTEMCTL --user daemon-reload 2>&1)"; then
    return 0
  fi
  if grep -Fq 'Failed to connect to bus' <<<"$output"; then
    fail "systemctl --user failed because the user bus is unavailable; log in with a user session or run 'sudo loginctl enable-linger $(id -un)'"
  fi
  printf '%s\n' "$output" >&2
  return 1
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

mapfile -t entries < <(tar -tzf "$ARCHIVE")
[[ ${#entries[@]} -gt 0 ]] || fail "archive is empty: $ARCHIVE"

requires_daemon_reload=0
for entry in "${entries[@]}"; do
  [[ -n "$entry" ]] || fail "archive contains an empty entry: $ARCHIVE"
  [[ "$entry" != /* ]] || fail "archive contains an absolute path: $entry"
  [[ "$entry" != *'/'* ]] || fail "archive contains nested paths: $entry"
  [[ "$entry" != '.' && "$entry" != '..' ]] || fail "archive contains an invalid entry: $entry"
  if [[ "$entry" =~ \.(container|service|volume|network)$ ]]; then
    requires_daemon_reload=1
  fi
done

if [[ "$LIST_ONLY" -eq 1 ]]; then
  printf 'Archive entries:\n'
  printf '  %s\n' "${entries[@]}"
  exit 0
fi

mkdir -p -m 700 "$TARGET_DIR"

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

tar -C "$TARGET_DIR" -xzf "$ARCHIVE"

if [[ "$SKIP_DAEMON_RELOAD" -eq 0 && "$requires_daemon_reload" -eq 1 ]]; then
  command -v "$SYSTEMCTL" >/dev/null 2>&1 || fail "required command not found: $SYSTEMCTL"
  run_daemon_reload
fi

printf 'OK: restored %s into %s\n' "$ARCHIVE" "$TARGET_DIR"
