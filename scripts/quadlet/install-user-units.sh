#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/deploy/quadlet"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
MODE="${QUADLET_INSTALL_MODE:-link}"

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

mkdir -p "$TARGET_DIR"
shopt -s nullglob

install_unit() {
  local src="$1"
  local name
  name="$(basename "$src")"
  local dst="$TARGET_DIR/$name"
  if [[ "$MODE" == "copy" ]]; then
    install -m 0644 "$src" "$dst"
  else
    ln -sfn "$src" "$dst"
  fi
}

for unit in "$SRC_DIR"/*.network "$SRC_DIR"/*.volume "$SRC_DIR"/*.container "$SRC_DIR"/*.service; do
  install_unit "$unit"
done

for example in "$SRC_DIR"/env/*.example "$SRC_DIR"/config/*.example; do
  local_name="$(basename "$example" .example)"
  if [[ ! -f "$TARGET_DIR/$local_name" ]]; then
    install -m 0600 "$example" "$TARGET_DIR/$local_name"
  fi
done

shopt -u nullglob

if command -v systemctl >/dev/null 2>&1; then
  if ! systemctl --user daemon-reload; then
    warn "systemctl --user daemon-reload skipped; user systemd bus is not available in this session"
  fi
else
  warn "systemctl not found; skipped daemon-reload"
fi

printf 'installed units into %s\n' "$TARGET_DIR"
printf 'next: edit %s/erp4-postgres.env and %s/erp4-backend.env, then run:\n' "$TARGET_DIR" "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service\n'
printf 'optional HTTPS proxy: edit %s/erp4-caddy.env and %s/erp4-caddy.Caddyfile, then run:\n' "$TARGET_DIR" "$TARGET_DIR"
printf '  systemctl --user enable --now erp4-caddy.service\n'
printf 'note: rootless auto-start requires sudo loginctl enable-linger %s\n' "$(id -un)"
