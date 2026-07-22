#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

MODE="read"
TARGET="chat"
DRY_RUN=0
ENV_FILE=""
PROVISION_FOLDER=0
RECONCILE_PROVISION=0
FOLDER_ID_OUTPUT_FILE=""
MARKDOWN_SUMMARY=""

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Wrapper for ERP4 Google Drive setup checks. Secret values are never printed by this
wrapper. --mode write creates and trashes a test file through the compiled backend CLI.

Options:
  --mode read|write           Drive check mode (default: read)
  --target chat|pdf|evidence|report
                              Context folder to check/provision (default: chat)
  --dry-run                   Print the command without executing it
  --env-file FILE             Read env vars from a regular caller-owned mode 600 file
  --provision-folder          Provision the selected target folder first
  --reconcile-provision       Reconcile a prior CREATE_STARTED protected output
  --folder-id-output-file FILE
                              Required with provision/reconcile; receives mode 600 env output
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
    PDF_GDRIVE_FOLDER_ID
    EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID
    REPORT_GDRIVE_FOLDER_ID
    ERP4_GDRIVE_CLIENT_ID
    ERP4_GDRIVE_CLIENT_SECRET
    ERP4_GDRIVE_REFRESH_TOKEN
    ERP4_GDRIVE_SHARED_DRIVE_ID
    ERP4_GDRIVE_TIMEOUT_MS
    ERP4_GDRIVE_MAX_RETRIES
    ERP4_GDRIVE_RETRY_BASE_DELAY_MS
    ERP4_GDRIVE_RESUMABLE_UPLOAD_THRESHOLD_BYTES
  )
  [[ -n "$ENV_FILE" ]] || return 0
  [[ -f "$ENV_FILE" ]] || ops_fail "env file not found: $ENV_FILE"
  [[ ! -L "$ENV_FILE" ]] || ops_fail 'env file must not be a symbolic link'
  ops_check_private_file_mode "$ENV_FILE" || exit 1
  [[ "$(stat -c '%u' "$ENV_FILE")" == "$(id -u)" ]] || ops_fail 'env file must be owned by the current user'
  # Treat an explicit env file as authoritative for this allowlist so ambient
  # credentials on a shared operator host cannot bleed into the check.
  for key in "${allowed_env[@]}"; do
    unset "$key"
  done
  for key in "${allowed_env[@]}"; do
    value="$(ops_read_env_value "$ENV_FILE" "$key")"
    if [[ -n "$value" ]]; then
      export "$key=$value"
    fi
  done
}

require_credential_set() {
  local common_keys=(ERP4_GDRIVE_CLIENT_ID ERP4_GDRIVE_CLIENT_SECRET ERP4_GDRIVE_REFRESH_TOKEN)
  local legacy_keys=(CHAT_ATTACHMENT_GDRIVE_CLIENT_ID CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN)
  local key value common_count=0 legacy_count=0 missing=0
  for key in "${common_keys[@]}"; do
    value="${!key:-}"
    [[ -n "${value// }" ]] && common_count=$((common_count + 1))
  done
  for key in "${legacy_keys[@]}"; do
    value="${!key:-}"
    [[ -n "${value// }" ]] && legacy_count=$((legacy_count + 1))
  done

  if [[ "$TARGET" != "chat" ]]; then
    for key in "${common_keys[@]}"; do
      value="${!key:-}"
      if [[ -z "${value// }" ]]; then
        ops_error "missing required env: $key (non-Chat targets do not use legacy fallback)"
        missing=1
      else
        ops_info "$key is set"
      fi
    done
  elif [[ "$common_count" -gt 0 ]]; then
    for key in "${common_keys[@]}"; do
      value="${!key:-}"
      if [[ -z "${value// }" ]]; then
        ops_error "missing required env: $key (partial common credential sets cannot use legacy fallback)"
        missing=1
      else
        ops_info "$key is set"
      fi
    done
  else
    for key in "${legacy_keys[@]}"; do
      value="${!key:-}"
      if [[ -z "${value// }" ]]; then
        ops_error "missing required compatibility credential: $key"
        missing=1
      else
        ops_info "compatibility credential $key is set"
      fi
    done
  fi

  if [[ "$legacy_count" -gt 0 ]]; then
    for key in "${legacy_keys[@]}"; do
      value="${!key:-}"
      [[ -n "${value// }" ]] && ops_warn "$key is deprecated; use the complete ERP4_GDRIVE_* credential set"
    done
  fi
  [[ "$missing" -eq 0 ]] || exit 1
}

require_envs() {
  local value missing=0
  require_credential_set
  if [[ "$PROVISION_FOLDER" -eq 1 && -z "$FOLDER_ID_OUTPUT_FILE" ]]; then
    ops_error 'missing required option: --folder-id-output-file with provision/reconcile'
    missing=1
  fi
  if [[ "$PROVISION_FOLDER" -eq 0 ]]; then
    value="${!TARGET_ENV_KEY:-}"
    if [[ -z "${value// }" ]]; then
      ops_error "missing required env: $TARGET_ENV_KEY"
      missing=1
    else
      ops_info "$TARGET_ENV_KEY is set"
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
    printf -- '- Target: `%s`\n' "$TARGET"
    printf -- '- Provision folder: `%s`\n' "$PROVISION_FOLDER"
    printf -- '- Reconcile provision: `%s`\n' "$RECONCILE_PROVISION"
    printf -- '- Env file used: `%s`\n' "${ENV_FILE:-no}"
    printf '\nSecret values are intentionally omitted.\n'
  } > "$MARKDOWN_SUMMARY"
}

run_backend_cli() {
  local entrypoint="$1"
  local script="$ROOT_DIR/packages/backend/dist/cli/$entrypoint.js"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[ops][dry-run] cd '
    printf '%q' "$ROOT_DIR"
    printf ' && '
    ops_quote_command node "$script"
  else
    [[ -f "$script" ]] || ops_fail "compiled backend CLI not found: run npm run build --prefix packages/backend"
    (cd "$ROOT_DIR" && node "$script")
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      ops_require_arg "$1" "${2:-}"
      MODE="$2"
      shift 2
      ;;
    --target)
      ops_require_arg "$1" "${2:-}"
      TARGET="$2"
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
      [[ "$RECONCILE_PROVISION" -eq 0 ]] || ops_fail '--provision-folder and --reconcile-provision are mutually exclusive'
      PROVISION_FOLDER=1
      shift
      ;;
    --reconcile-provision)
      [[ "$PROVISION_FOLDER" -eq 0 ]] || ops_fail '--provision-folder and --reconcile-provision are mutually exclusive'
      PROVISION_FOLDER=1
      RECONCILE_PROVISION=1
      shift
      ;;
    --folder-id-output-file)
      ops_require_arg "$1" "${2:-}"
      FOLDER_ID_OUTPUT_FILE="$2"
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

case "$MODE" in read|write) ;; *) ops_fail '--mode must be read or write' ;; esac
case "$TARGET" in
  chat)
    TARGET_ENV_KEY=CHAT_ATTACHMENT_GDRIVE_FOLDER_ID
    TARGET_FOLDER_NAME='ERP4 Chat Attachments'
    ;;
  pdf)
    TARGET_ENV_KEY=PDF_GDRIVE_FOLDER_ID
    TARGET_FOLDER_NAME='ERP4 PDF Artifacts'
    ;;
  evidence)
    TARGET_ENV_KEY=EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID
    TARGET_FOLDER_NAME='ERP4 Evidence Archives'
    ;;
  report)
    TARGET_ENV_KEY=REPORT_GDRIVE_FOLDER_ID
    TARGET_FOLDER_NAME='ERP4 Report Outputs'
    ;;
  *) ops_fail '--target must be chat, pdf, evidence, or report' ;;
esac
unset ERP4_GDRIVE_TARGET_FOLDER_ID GDRIVE_FOLDER_ID_OUTPUT_KEY ERP4_GDRIVE_TARGET_FOLDER_NAME
load_env_file
require_envs
if [[ "$PROVISION_FOLDER" -eq 1 ]]; then
  export GDRIVE_FOLDER_ID_OUTPUT_FILE="$FOLDER_ID_OUTPUT_FILE"
  export GDRIVE_FOLDER_ID_OUTPUT_KEY="$TARGET_ENV_KEY"
  export ERP4_GDRIVE_TARGET_FOLDER_NAME="$TARGET_FOLDER_NAME"
  if [[ "$RECONCILE_PROVISION" -eq 1 ]]; then
    export GDRIVE_PROVISION_MODE=reconcile
  else
    export GDRIVE_PROVISION_MODE=provision
  fi
  run_backend_cli googleDriveProvisionFolder
  if [[ "$DRY_RUN" -eq 0 ]]; then
    ops_check_private_file_mode "$FOLDER_ID_OUTPUT_FILE" || exit 1
    target_folder_id="$(ops_read_env_value "$FOLDER_ID_OUTPUT_FILE" "$TARGET_ENV_KEY")"
    [[ -n "$target_folder_id" ]] || ops_fail "provision output is missing $TARGET_ENV_KEY"
    if [[ "$TARGET" == "chat" ]]; then
      export CHAT_ATTACHMENT_GDRIVE_FOLDER_ID="$target_folder_id"
    else
      export ERP4_GDRIVE_TARGET_FOLDER_ID="$target_folder_id"
    fi
  fi
elif [[ "$TARGET" != "chat" ]]; then
  export ERP4_GDRIVE_TARGET_FOLDER_ID="${!TARGET_ENV_KEY}"
fi
export GDRIVE_CHECK_MODE="$MODE"
run_backend_cli googleDriveCheck
write_summary
