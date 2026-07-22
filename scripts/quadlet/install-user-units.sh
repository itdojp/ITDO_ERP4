#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/deploy/quadlet"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
MODE="${QUADLET_INSTALL_MODE:-link}"

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
  if output="$(systemctl --user daemon-reload 2>&1)"; then
    return 0
  fi
  if grep -Fq 'Failed to connect to bus' <<<"$output"; then
    warn "systemctl --user daemon-reload skipped; user systemd bus is not available in this session"
    return 0
  fi
  printf '%s\n' "$output" >&2
  return 1
}

mkdir -p "$TARGET_DIR"
shopt -s nullglob
ERP4_IMAGE_TAG="$(resolve_image_tag)"
export ERP4_IMAGE_TAG

install_unit() {
  local src="$1"
  local name
  name="$(basename "$src")"
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

for unit in "$SRC_DIR"/*.network "$SRC_DIR"/*.volume "$SRC_DIR"/*.container "$SRC_DIR"/*.service "$SRC_DIR"/*.timer; do
  install_unit "$unit"
done

for example in "$SRC_DIR"/env/*.example "$SRC_DIR"/config/*.example; do
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

if command -v systemctl >/dev/null 2>&1; then
  run_daemon_reload
else
  warn "systemctl not found; skipped daemon-reload"
fi

printf 'installed units into %s\n' "$TARGET_DIR"
printf 'rendered local application image tag: %s\n' "$ERP4_IMAGE_TAG"
printf 'next: edit %s/erp4-postgres.env and %s/erp4-backend.env, then run:\n' "$TARGET_DIR" "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service\n'
printf 'optional HTTPS proxy: edit %s/erp4-caddy.env and %s/erp4-caddy.Caddyfile, then run:\n' "$TARGET_DIR" "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-caddy.service\n'
printf 'optional scheduled config backups: edit %s/erp4-maintenance.env, then run:\n' "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-config-backup.timer\n'
printf 'optional scheduled database backups: edit %s/erp4-maintenance.env, then run:\n' "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-db-backup.timer\n'
printf 'optional storage readiness monitoring: edit %s/erp4-storage-readiness.env, then run:\n' "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-storage-readiness.timer\n'
printf 'optional scheduled backup pruning: edit %s/erp4-maintenance.env, then run:\n' "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-config-prune.timer\n'
printf 'note: rootless auto-start requires sudo loginctl enable-linger %s\n' "$(id -un)"
