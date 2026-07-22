#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/deploy/quadlet"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
SYSTEMD_USER_TARGET_DIR="${SYSTEMD_USER_TARGET_DIR:-$HOME/.config/systemd/user}"
MODE="${QUADLET_INSTALL_MODE:-link}"
PROFILE="${SAKURA_VPS_PROFILE:-production}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]
  --profile NAME     Install production, private-smoke, or https-trial units
  --target-dir DIR   Install units into DIR
  --systemd-user-target-dir DIR
                     Register native .service/.timer units in DIR
  -h, --help         Show this help message and exit
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

resolve_image_tag() {
  local tag="${ERP4_IMAGE_TAG:-}"
  if [[ -z "$tag" ]]; then
    if tag="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null)"; then
      :
    else
      fail "ERP4_IMAGE_TAG is required when the repository commit cannot be resolved"
    fi
  fi
  if [[ ! "$tag" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    fail "ERP4_IMAGE_TAG contains characters that are unsafe for an image tag: $tag"
  fi
  printf '%s\n' "$tag"
}

run_daemon_reload() {
  local output
  if output="$("$SYSTEMCTL" --user daemon-reload 2>&1)"; then
    return 0
  fi
  if grep -Fq 'Failed to connect to bus' <<<"$output"; then
    warn "systemctl --user daemon-reload skipped; user systemd bus is not available in this session"
    return 0
  fi
  printf '%s\n' "$output" >&2
  return 1
}

is_proxy_artifact() {
  case "$(basename "$1")" in
    erp4-caddy.*|erp4-caddy-*) return 0 ;;
    *) return 1 ;;
  esac
}

require_clean_private_smoke_target() {
  local path
  for path in \
    "$TARGET_DIR/erp4-caddy.container" \
    "$TARGET_DIR/erp4-caddy.env" \
    "$TARGET_DIR/erp4-caddy.Caddyfile" \
    "$TARGET_DIR/erp4-caddy-data.volume" \
    "$TARGET_DIR/erp4-caddy-config.volume"; do
    if [[ -e "$path" || -L "$path" ]]; then
      fail "private-smoke target contains proxy artifact: $path; back up and remove proxy artifacts explicitly before retrying"
    fi
  done
}

require_managed_native_target() {
  local unit name source destination current_target
  for unit in "$SRC_DIR"/*.service "$SRC_DIR"/*.timer; do
    name="$(basename "$unit")"
    source="$TARGET_DIR/$name"
    destination="$SYSTEMD_USER_TARGET_DIR/$name"
    if [[ "$source" == "$destination" ]]; then
      continue
    fi
    if [[ -e "$destination" && ! -L "$destination" ]]; then
      fail "native systemd unit already exists and will not be overwritten: $destination"
    fi
    if [[ -L "$destination" ]]; then
      current_target="$(readlink "$destination")"
      if [[ "$current_target" != "$source" ]]; then
        fail "native systemd unit symlink points outside the managed Quadlet target: $destination -> $current_target"
      fi
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      [[ $# -ge 2 ]] || fail 'missing argument for --profile'
      PROFILE="$2"
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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

command -v realpath >/dev/null 2>&1 || fail 'required command not found: realpath'
[[ -n "$TARGET_DIR" ]] || fail 'target directory must not be empty'
[[ -n "$SYSTEMD_USER_TARGET_DIR" ]] || fail 'systemd user target directory must not be empty'
TARGET_DIR="$(realpath -m -- "$TARGET_DIR")"
SYSTEMD_USER_TARGET_DIR="$(realpath -m -- "$SYSTEMD_USER_TARGET_DIR")"

case "$PROFILE" in
  production|private-smoke|https-trial) ;;
  *) fail "unknown profile: $PROFILE" ;;
esac

if [[ "$PROFILE" == "private-smoke" ]]; then
  require_clean_private_smoke_target
fi
require_managed_native_target

mkdir -p "$TARGET_DIR" "$SYSTEMD_USER_TARGET_DIR"
shopt -s nullglob
ERP4_IMAGE_TAG="$(resolve_image_tag)"
export ERP4_IMAGE_TAG

install_unit() {
  local src="$1"
  local name
  name="$(basename "$src")"
  local profile_src="$SRC_DIR/profiles/$PROFILE/$name"
  if [[ -f "$profile_src" ]]; then
    src="$profile_src"
  fi
  local dst="$TARGET_DIR/$name"
  if grep -Fq 'REPLACE_WITH_COMMIT_SHA' "$src"; then
    sed "s/REPLACE_WITH_COMMIT_SHA/${ERP4_IMAGE_TAG}/g" "$src" > "$dst"
    chmod 0644 "$dst"
  elif [[ "$MODE" == "copy" ]]; then
    install -m 0644 "$src" "$dst"
  else
    ln -sfn "$src" "$dst"
  fi
}

register_native_unit() {
  local name="$1"
  local source="$TARGET_DIR/$name"
  local destination="$SYSTEMD_USER_TARGET_DIR/$name"

  [[ -e "$source" || -L "$source" ]] || fail "native unit source not found: $source"
  if [[ "$source" == "$destination" ]]; then
    return 0
  fi
  if [[ -L "$destination" ]]; then
    local current_target
    current_target="$(readlink "$destination")"
    if [[ "$current_target" != "$source" ]]; then
      fail "native systemd unit symlink changed during install: $destination -> $current_target"
    fi
    return 0
  fi
  ln -s "$source" "$destination"
}

for unit in "$SRC_DIR"/*.network "$SRC_DIR"/*.volume "$SRC_DIR"/*.container "$SRC_DIR"/*.service "$SRC_DIR"/*.timer; do
  if [[ "$PROFILE" == "private-smoke" ]] && is_proxy_artifact "$unit"; then
    continue
  fi
  install_unit "$unit"
done

# Quadlet's generator ignores native .service/.timer files. Keep their managed
# copies beside the Quadlet sources for backup compatibility, and register only
# those native units in systemd's user unit search path.
for unit in "$SRC_DIR"/*.service "$SRC_DIR"/*.timer; do
  register_native_unit "$(basename "$unit")"
done

for example in "$SRC_DIR"/env/*.example "$SRC_DIR"/config/*.example; do
  if [[ "$PROFILE" == "private-smoke" ]] && is_proxy_artifact "$example"; then
    continue
  fi
  local_name="$(basename "$example" .example)"
  if [[ ! -f "$TARGET_DIR/$local_name" ]]; then
    mode=0600
    case "$example" in
      "$SRC_DIR"/config/*)
        mode=0644
        ;;
    esac
    install -m "$mode" "$example" "$TARGET_DIR/$local_name"
  fi
done

shopt -u nullglob

if command -v "$SYSTEMCTL" >/dev/null 2>&1; then
  run_daemon_reload
else
  warn "systemctl not found; skipped daemon-reload"
fi

printf 'installed units into %s\n' "$TARGET_DIR"
printf 'registered native systemd user units in %s\n' "$SYSTEMD_USER_TARGET_DIR"
printf 'installed profile: %s\n' "$PROFILE"
printf 'rendered local application image tag: %s\n' "$ERP4_IMAGE_TAG"
printf 'next: edit %s/erp4-postgres.env and %s/erp4-backend.env, then run:\n' "$TARGET_DIR" "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service\n'
if [[ "$PROFILE" != "private-smoke" ]]; then
  printf 'optional HTTPS proxy: edit %s/erp4-caddy.env and %s/erp4-caddy.Caddyfile, then run:\n' "$TARGET_DIR" "$TARGET_DIR"
  printf '  systemctl --user enable --now erp4-caddy.service\n'
fi
printf 'optional scheduled config backups: edit %s/erp4-maintenance.env, then run:\n' "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-config-backup.timer\n'
printf 'optional scheduled database backups: edit %s/erp4-maintenance.env, then run:\n' "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-db-backup.timer\n'
printf 'optional storage readiness monitoring: edit %s/erp4-storage-readiness.env, then run:\n' "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-storage-readiness.timer\n'
printf 'optional scheduled backup pruning: edit %s/erp4-maintenance.env, then run:\n' "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-config-prune.timer\n'
printf 'note: rootless auto-start requires sudo loginctl enable-linger %s\n' "$(id -un)"
