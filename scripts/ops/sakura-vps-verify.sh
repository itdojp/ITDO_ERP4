#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="check"
TARGET_DIR="${QUADLET_TARGET_DIR:-$HOME/.config/containers/systemd}"
FRONTEND_BUILD_ENV="${FRONTEND_BUILD_ENV_FILE:-$ROOT_DIR/deploy/quadlet/env/erp4-frontend-build.env}"
INCLUDE_PROXY=0
RESOLVE_IP=""
INSECURE=0
GDRIVE_MODE="skip"
MARKDOWN_SUMMARY=""
SUMMARY_LINES=()
FAILURES=0
PROFILE="${SAKURA_VPS_PROFILE:-production}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--check] [options]

Read-only verification helper for ERP4 Sakura VPS deployments. Google Drive write
verification is opt-in via --gdrive-mode write and creates/deletes a test file.

Options:
  --check                         Run verification (default)
  --target-dir DIR                Quadlet target directory
  --frontend-build-env FILE       Frontend build env file
  --profile NAME                  Use production, private-smoke, or https-trial
  --include-proxy                 Verify HTTPS proxy as well
  --resolve-ip ADDR               Pass to check-https.sh before DNS propagation
  --insecure                      Pass -k to HTTPS verification
  --gdrive-mode skip|read|write   Drive check mode (default: skip)
  --markdown-summary FILE         Write secret-free Markdown summary
  -h, --help                      Show this help message
USAGE
}

add_summary() {
  SUMMARY_LINES+=("$1")
}

run_step() {
  local label="$1"
  shift
  printf '==> %s\n' "$label"
  if "$@"; then
    add_summary "- ✅ $label"
  else
    FAILURES=$((FAILURES + 1))
    add_summary "- ❌ $label"
    return 1
  fi
}

write_summary() {
  [[ -n "$MARKDOWN_SUMMARY" ]] || return 0
  {
    printf '# ERP4 Sakura VPS verification\n\n'
    printf -- '- Date: `%s`\n' "$(ops_timestamp)"
    printf -- '- Profile: `%s`\n' "$PROFILE"
    printf -- '- Target dir: `%s`\n' "$TARGET_DIR"
    printf -- '- Include proxy: `%s`\n' "$INCLUDE_PROXY"
    printf -- '- Google Drive mode: `%s`\n\n' "$GDRIVE_MODE"
    printf '## Results\n\n'
    printf '%s\n' "${SUMMARY_LINES[@]}"
  } > "$MARKDOWN_SUMMARY"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      MODE="check"
      shift
      ;;
    --target-dir)
      ops_require_arg "$1" "${2:-}"
      TARGET_DIR="$2"
      shift 2
      ;;
    --frontend-build-env)
      ops_require_arg "$1" "${2:-}"
      FRONTEND_BUILD_ENV="$2"
      shift 2
      ;;
    --profile)
      ops_require_arg "$1" "${2:-}"
      PROFILE="$2"
      shift 2
      ;;
    --include-proxy)
      INCLUDE_PROXY=1
      shift
      ;;
    --resolve-ip)
      ops_require_arg "$1" "${2:-}"
      RESOLVE_IP="$2"
      shift 2
      ;;
    --insecure)
      INSECURE=1
      shift
      ;;
    --gdrive-mode)
      ops_require_arg "$1" "${2:-}"
      GDRIVE_MODE="$2"
      shift 2
      ;;
    --markdown-summary)
      ops_require_arg "$1" "${2:-}"
      MARKDOWN_SUMMARY="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      ops_fail "unknown argument: $1"
      ;;
  esac
done

[[ "$MODE" == "check" ]] || ops_fail 'only --check is supported by this script'
case "$GDRIVE_MODE" in skip|read|write) ;; *) ops_fail '--gdrive-mode must be skip, read, or write' ;; esac
case "$PROFILE" in
  production|private-smoke|https-trial) ;;
  *) ops_fail "unknown profile: $PROFILE" ;;
esac
if [[ "$PROFILE" == "private-smoke" && "$INCLUDE_PROXY" -eq 1 ]]; then
  ops_fail 'private-smoke must not include proxy'
fi
if [[ "$PROFILE" == "https-trial" && "$INCLUDE_PROXY" -eq 0 ]]; then
  ops_fail 'https-trial requires --include-proxy'
fi

run_step 'Quadlet env validation' "$ROOT_DIR/scripts/quadlet/check-env.sh" --profile "$PROFILE" --target-dir "$TARGET_DIR" --frontend-build-env "$FRONTEND_BUILD_ENV" || true
run_step 'Quadlet stack readiness' "$ROOT_DIR/scripts/quadlet/check-stack.sh" || true
run_step 'Quadlet stack status' "$ROOT_DIR/scripts/quadlet/status-stack.sh" || true
if [[ "$INCLUDE_PROXY" -eq 1 ]]; then
  https_args=(--target-dir "$TARGET_DIR")
  [[ -z "$RESOLVE_IP" ]] || https_args+=(--resolve-ip "$RESOLVE_IP")
  [[ "$INSECURE" -eq 0 ]] || https_args+=(--insecure)
  run_step 'HTTPS proxy verification' "$ROOT_DIR/scripts/quadlet/check-https.sh" "${https_args[@]}" || true
fi
if [[ "$GDRIVE_MODE" != "skip" ]]; then
  run_step "Google Drive ${GDRIVE_MODE} verification" "$ROOT_DIR/scripts/ops/gcp-drive-check.sh" --mode "$GDRIVE_MODE" || true
fi

write_summary
if (( FAILURES > 0 )); then
  ops_fail "verification failed: $FAILURES step(s)"
fi
ops_info 'verification completed'
