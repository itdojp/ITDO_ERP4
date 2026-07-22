#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/packages/backend/dist/cli/storageReadiness.js"

if [[ ! -f "$CLI" || -L "$CLI" ]]; then
  echo '[storage-readiness][error] backend CLI is not built; run make build' >&2
  exit 64
fi

exec node "$CLI" "$@"
