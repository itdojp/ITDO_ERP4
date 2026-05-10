#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="read"
DRY_RUN=0
ENV_FILE=""
PROVISION_FOLDER=0
MARKDOWN_SUMMARY=""
REQUIRED_ENV=(CHAT_ATTACHMENT_GDRIVE_CLIENT_ID CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN)

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Wrapper for ERP4 Google Drive setup checks. Secret values are never printed by this
wrapper. --mode write creates and deletes/trashes a test file via scripts/check-chat-gdrive.ts.

Options:
  --mode read|write           Drive check mode (default: read)
  --dry-run                   Print the command without executing it
  --env-file FILE             Source env vars from FILE (warns if not chmod 600)
  --provision-folder          Run scripts/provision-chat-gdrive-folder.ts first
  --markdown-summary FILE     Write secret-free Markdown summary
  -h, --help                  Show this help message
USAGE
}

load_env_file() {
  local key value
  local allowed_env=(
    CHAT_ATTACHMENT_GDRIVE_CLIENT_ID
    CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET
    CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN
    CHAT_ATTACHMENT_GDRIVE_FOLDER_ID
    CHAT_ATTACHMENT_GDRIVE_FOLDER_NAME
  )
  [[ -n "$ENV_FILE" ]] || return 0
  [[ -f "$ENV_FILE" ]] || ops_fail "env file not found: $ENV_FILE"
  ops_check_private_file_mode "$ENV_FILE" || true
  for key in "${allowed_env[@]}"; do
    value="$(ops_read_env_value "$ENV_FILE" "$key")"
    if [[ -n "$value" ]]; then
      export "$key=$value"
    fi
  done
}

require_envs() {
  local key value missing=0
  for key in "${REQUIRED_ENV[@]}"; do
    value="${!key:-}"
    if [[ -z "${value// }" ]]; then
      ops_error "missing required env: $key"
      missing=1
    else
      ops_info "$key is set"
    fi
  done
  if [[ "$PROVISION_FOLDER" -eq 0 ]]; then
    value="${CHAT_ATTACHMENT_GDRIVE_FOLDER_ID:-}"
    if [[ -z "${value// }" ]]; then
      ops_error 'missing required env: CHAT_ATTACHMENT_GDRIVE_FOLDER_ID'
      missing=1
    else
      ops_info "CHAT_ATTACHMENT_GDRIVE_FOLDER_ID is set"
    fi
  fi
  [[ "$missing" -eq 0 ]] || exit 1
}

write_summary() {
  [[ -n "$MARKDOWN_SUMMARY" ]] || return 0
  {
    printf '# ERP4 Google Drive check\n\n'
    printf -- '- Date: `%s`\n' "$(ops_timestamp)"
    printf -- '- Mode: `%s`\n' "$MODE"
    printf -- '- Provision folder: `%s`\n' "$PROVISION_FOLDER"
    printf -- '- Env file used: `%s`\n' "${ENV_FILE:-no}"
    printf '\nSecret values are intentionally omitted.\n'
  } > "$MARKDOWN_SUMMARY"
}

run_ts_node() {
  local script="$1"
  shift || true
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[ops][dry-run] cd '
    printf '%q' "$ROOT_DIR"
    printf ' && '
    ops_quote_command npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json "$script" "$@"
  else
    (cd "$ROOT_DIR" && npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json "$script" "$@")
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      ops_require_arg "$1" "${2:-}"
      MODE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --env-file)
      ops_require_arg "$1" "${2:-}"
      ENV_FILE="$2"
      shift 2
      ;;
    --provision-folder)
      PROVISION_FOLDER=1
      shift
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

case "$MODE" in read|write) ;; *) ops_fail '--mode must be read or write' ;; esac
load_env_file
require_envs
if [[ "$PROVISION_FOLDER" -eq 1 ]]; then
  run_ts_node scripts/provision-chat-gdrive-folder.ts
fi
export GDRIVE_CHECK_MODE="$MODE"
run_ts_node scripts/check-chat-gdrive.ts
write_summary
