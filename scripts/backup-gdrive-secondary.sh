#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/packages/backend/dist/cli/backupGoogleDriveSecondary.js"

if [[ ! -f "$CLI" || -L "$CLI" ]]; then
  echo 'backup Google Drive CLI is not built' >&2
  exit 1
fi

exec node "$CLI" "$@"
