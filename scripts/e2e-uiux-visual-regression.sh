#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/e2e-uiux-visual-regression.sh [--update-snapshots]

Runs the opt-in UX/UI visual regression suite against the local E2E stack.

Options:
  --update-snapshots  Refresh Playwright screenshot baselines.
  -h, --help          Show this help.

Environment:
  BACKEND_PORT / FRONTEND_PORT / E2E_DB_MODE / DATABASE_URL and the usual
  scripts/e2e-frontend.sh variables are honored.
USAGE
}

extra_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update-snapshots)
      extra_args+=("--update-snapshots")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ${#extra_args[@]} -gt 0 ]]; then
  E2E_PLAYWRIGHT_EXTRA_ARGS="${extra_args[*]} ${E2E_PLAYWRIGHT_EXTRA_ARGS:-}"
fi

export E2E_CAPTURE="${E2E_CAPTURE:-0}"
export E2E_SCOPE="visual"
export E2E_PLAYWRIGHT_EXTRA_ARGS="${E2E_PLAYWRIGHT_EXTRA_ARGS:-}"
export UIUX_VISUAL_REGRESSION=1

exec "$ROOT_DIR/scripts/e2e-frontend.sh"
