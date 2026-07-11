#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
TARGET_ENVIRONMENT="${TARGET_ENVIRONMENT:-}"
OPERATOR="${OPERATOR:-}"
RESTORE_STATUS="${RESTORE_STATUS:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_REGION="${S3_REGION:-}"
S3_PREFIX="${S3_PREFIX:-}"
ENCRYPTION_MODE="${ENCRYPTION_MODE:-}"
KMS_KEY_ID="${KMS_KEY_ID:-}"
DECISION_RECORD_FILE="${DECISION_RECORD_FILE:-}"
READINESS_RECORD_FILE="${READINESS_RECORD_FILE:-}"
BACKUP_LOG_FILE="${BACKUP_LOG_FILE:-}"
UPLOAD_LOG_FILE="${UPLOAD_LOG_FILE:-}"
DOWNLOAD_LOG_FILE="${DOWNLOAD_LOG_FILE:-}"
RESTORE_LOG_FILE="${RESTORE_LOG_FILE:-}"
INTEGRITY_REPORT_JSON="${INTEGRITY_REPORT_JSON:-}"
TRIAL_NOTES="${TRIAL_NOTES:-}"

readonly -a REQUIRED_DECISION_FIELDS=(
  "decisionDate"
  "environment"
  "owner"
  "reviewers"
  "bucketName"
  "region"
  "s3Prefix"
  "encryptionMode"
  "kmsKeyIdOrAlias"
  "versioning"
  "lifecycleDailyDays"
  "lifecycleWeeklyWeeks"
  "lifecycleMonthlyMonths"
  "writeRoleArn"
  "readRoleArn"
  "restoreRoleArn"
  "restoreApprover"
  "restoreExecutor"
  "auditLogLocation"
  "evidenceRecordPath"
)

usage() {
  cat <<USAGE
Usage:
  TARGET_ENVIRONMENT=prod OPERATOR=alice RESTORE_STATUS=pass \\
  S3_BUCKET=erp4-backups S3_REGION=ap-northeast-1 S3_PREFIX=erp4/prod \\
  ENCRYPTION_MODE=SSE-KMS KMS_KEY_ID=alias/erp4-backup \\
  DECISION_RECORD_FILE=docs/ops/backup-s3-decision-checklist.md \\
  READINESS_RECORD_FILE=docs/test-results/YYYY-MM-DD-backup-s3-readiness-rN.md \\
  BACKUP_LOG_FILE=tmp/backup-prod/backup.log \\
  UPLOAD_LOG_FILE=tmp/backup-prod/upload.log \\
  DOWNLOAD_LOG_FILE=tmp/backup-prod/download.log \\
  RESTORE_LOG_FILE=tmp/backup-prod/restore.log \\
  INTEGRITY_REPORT_JSON=tmp/backup-prod/post-restore-integrity.json \\
    ./scripts/record-backup-s3-restore.sh

Optional env:
  OUT_DIR=...                         # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|s3-restore-YYYYMMDD... # auto-increments rN when omitted
  RESTORE_STATUS=pass|failed|blocked  # required
  TARGET_ENVIRONMENT=...              # required
  OPERATOR=...                        # required
  S3_BUCKET=...                       # required when RESTORE_STATUS=pass
  S3_REGION=...                       # required when RESTORE_STATUS=pass
  S3_PREFIX=...                       # required when RESTORE_STATUS=pass
  ENCRYPTION_MODE=SSE-KMS|SSE-S3      # required when RESTORE_STATUS=pass
  KMS_KEY_ID=...                      # required when ENCRYPTION_MODE=SSE-KMS and RESTORE_STATUS=pass
  DECISION_RECORD_FILE=...            # required when RESTORE_STATUS=pass; must have no required placeholders
  READINESS_RECORD_FILE=...           # required when RESTORE_STATUS=pass; summaryStatus pass and CHECK_WRITE=1
  BACKUP_LOG_FILE=...                 # required when RESTORE_STATUS=pass
  UPLOAD_LOG_FILE=...                 # required when RESTORE_STATUS=pass
  DOWNLOAD_LOG_FILE=...               # required when RESTORE_STATUS=pass
  RESTORE_LOG_FILE=...                # required when RESTORE_STATUS=pass
  INTEGRITY_REPORT_JSON=...           # required when RESTORE_STATUS=pass
  TRIAL_NOTES='free-form notes'

INTEGRITY_REPORT_JSON accepted pass shapes:
  {
    "countsMatch": true,
    "amountsMatch": true,
    "referencesMatch": true,
    "filesMatch": true
  }
  or nested checks such as checks.counts.status = "pass".

Validation:
- DATE_STAMP must be a valid calendar date.
- RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$.
- A pass record requires finalized S3 decision fields, S3 readiness pass with write probe,
  backup/upload/download/restore logs, and post-restore integrity JSON with all required checks true.
- Decision record bucket/region/prefix/encryption/environment values must match the supplied env.
- Existing output files are never overwritten.
USAGE
}

die() {
  echo "[record-backup-s3-restore][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[record-backup-s3-restore] $*"
}

resolve_absolute_path() {
  local input="$1"
  if [[ "$input" = /* ]]; then
    printf '%s\n' "$input"
  else
    printf '%s\n' "$ROOT_DIR/$input"
  fi
}

format_source_path() {
  local input="$1"
  if [[ -z "$input" ]]; then
    printf 'not_provided\n'
    return
  fi
  case "$input" in
    "$ROOT_DIR"/*)
      printf '%s\n' "${input#"$ROOT_DIR"/}"
      ;;
    *)
      printf '%s\n' "$input"
      ;;
  esac
}

validate_date_stamp() {
  if ! [[ "$DATE_STAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    die "DATE_STAMP must be YYYY-MM-DD"
  fi
  local parsed=""
  if parsed="$(date -d "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  elif parsed="$(date -j -f '%Y-%m-%d' "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  fi
  [[ "$parsed" == "$DATE_STAMP" ]] || die "DATE_STAMP is not a valid calendar date: $DATE_STAMP"
}

validate_run_label() {
  if [[ -z "$RUN_LABEL" ]]; then
    return 0
  fi
  [[ "$RUN_LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$"
}

validate_enums() {
  case "$RESTORE_STATUS" in
    pass|failed|blocked) ;;
    "") die "RESTORE_STATUS is required and must be pass, failed, or blocked" ;;
    *) die "RESTORE_STATUS must be pass, failed, or blocked" ;;
  esac
  if [[ -n "$ENCRYPTION_MODE" ]]; then
    case "$ENCRYPTION_MODE" in
      SSE-KMS|SSE-S3) ;;
      *) die "ENCRYPTION_MODE must be SSE-KMS or SSE-S3" ;;
    esac
  fi
}

require_non_empty() {
  local value="$1"
  local label="$2"
  if [[ -z "$value" ]]; then
    die "$label is required"
  fi
}

require_file() {
  local file_path="$1"
  local label="$2"
  if [[ ! -f "$file_path" ]]; then
    die "$label not found: $file_path"
  fi
}

require_non_empty_file() {
  local file_path="$1"
  local label="$2"
  require_file "$file_path" "$label"
  if [[ ! -s "$file_path" ]]; then
    die "$label is empty: $file_path"
  fi
}

decision_field_value() {
  local file_path="$1"
  local field="$2"
  grep -E "^[[:space:]]*-[[:space:]]*${field}:" "$file_path" | head -n 1 | sed -E "s/^[[:space:]]*-[[:space:]]*${field}:[[:space:]]*//" || true
}

normalize_decision_value() {
  local value="$1"
  printf '%s\n' "$value" \
    | sed -E "s/^[[:space:]]+//; s/[[:space:]]+$//; s/^\`//; s/\`$//; s/^[[:space:]]+//; s/[[:space:]]+$//"
}

is_placeholder_value() {
  local value="$1"
  value="$(normalize_decision_value "$value")"
  [[ -z "$value" ]] && return 0
  [[ "$value" =~ ^[[:space:]]*$ ]] && return 0
  [[ "$value" == "-" ]] && return 0
  [[ "$value" == *"YYYY-MM-DD"* ]] && return 0
  [[ "$value" == *"|"* ]] && return 0
  [[ "$value" == *"<"* ]] && return 0
  [[ "$value" == *"..."* ]] && return 0
  [[ "$value" == *"未定"* ]] && return 0
  [[ "$value" == *"未確定"* ]] && return 0
  [[ "$value" == *"TBD"* ]] && return 0
  [[ "$value" == *"TODO"* ]] && return 0
  return 1
}

decision_missing_fields() {
  local file_path="$1"
  local field value
  local -a missing=()
  for field in "${REQUIRED_DECISION_FIELDS[@]}"; do
    value="$(decision_field_value "$file_path" "$field")"
    if is_placeholder_value "$value"; then
      missing+=("$field")
    fi
  done
  if ((${#missing[@]} > 0)); then
    local IFS=", "
    printf '%s\n' "${missing[*]}"
    return 1
  fi
  return 0
}

decision_value_matches() {
  local file_path="$1"
  local field="$2"
  local expected="$3"
  local actual
  actual="$(normalize_decision_value "$(decision_field_value "$file_path" "$field")")"
  expected="$(normalize_decision_value "$expected")"
  [[ "$actual" == "$expected" ]]
}

decision_mismatch_fields() {
  local file_path="$1"
  local -a mismatches=()
  decision_value_matches "$file_path" "environment" "$TARGET_ENVIRONMENT" || mismatches+=("environment")
  decision_value_matches "$file_path" "bucketName" "$S3_BUCKET" || mismatches+=("bucketName")
  decision_value_matches "$file_path" "region" "$S3_REGION" || mismatches+=("region")
  decision_value_matches "$file_path" "s3Prefix" "$S3_PREFIX" || mismatches+=("s3Prefix")
  decision_value_matches "$file_path" "encryptionMode" "$ENCRYPTION_MODE" || mismatches+=("encryptionMode")
  if [[ "$ENCRYPTION_MODE" == "SSE-KMS" ]]; then
    decision_value_matches "$file_path" "kmsKeyIdOrAlias" "$KMS_KEY_ID" || mismatches+=("kmsKeyIdOrAlias")
  fi
  if ((${#mismatches[@]} > 0)); then
    local IFS=", "
    printf '%s\n' "${mismatches[*]}"
    return 1
  fi
  return 0
}

readiness_is_pass() {
  local file_path="$1"
  grep -Eq "summaryStatus:[[:space:]]*\`?pass\`?" "$file_path"
}

readiness_has_write_probe() {
  local file_path="$1"
  grep -Eq "check_write=1|CHECK_WRITE:[[:space:]]*\`?1\`?" "$file_path"
}

integrity_value() {
  local file_path="$1"
  local check_name="$2"
  node - "$file_path" "$check_name" <<'NODE'
const fs = require('node:fs');
const filePath = process.argv[2];
const checkName = process.argv[3];
const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const aliases = {
  counts: ['countsMatch', 'countMatch', 'rowCountsMatch', 'counts'],
  amounts: ['amountsMatch', 'amountMatch', 'monetaryAmountsMatch', 'amounts'],
  references: ['referencesMatch', 'referenceIntegrityMatch', 'referentialIntegrityMatch', 'references'],
  files: ['filesMatch', 'requiredFilesMatch', 'requiredFilesPresent', 'files'],
};
function normalize(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['true', 'pass', 'passed', 'ok', 'success', 'matched'].includes(lowered)) return true;
    if (['false', 'fail', 'failed', 'ng', 'mismatch', 'missing'].includes(lowered)) return false;
  }
  if (value && typeof value === 'object') {
    if ('match' in value) return normalize(value.match);
    if ('matched' in value) return normalize(value.matched);
    if ('ok' in value) return normalize(value.ok);
    if ('status' in value) return normalize(value.status);
    if ('result' in value) return normalize(value.result);
  }
  return null;
}
const candidates = [];
for (const key of aliases[checkName] || [checkName]) {
  candidates.push(parsed?.[key]);
  candidates.push(parsed?.checks?.[key]);
}
for (const candidate of candidates) {
  const normalized = normalize(candidate);
  if (normalized !== null) {
    process.stdout.write(normalized ? 'true' : 'false');
    process.exit(0);
  }
}
process.stdout.write('unknown');
NODE
}

resolve_output_file() {
  local output_file
  if [[ -n "$RUN_LABEL" ]]; then
    output_file="$OUT_DIR/${DATE_STAMP}-backup-s3-restore-${RUN_LABEL}.md"
    [[ ! -e "$output_file" ]] || die "output file already exists: $output_file"
    printf '%s\n' "$output_file"
    return
  fi
  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-backup-s3-restore-r${n}.md"
    if [[ ! -e "$output_file" ]]; then
      printf '%s\n' "$output_file"
      return
    fi
    n=$((n + 1))
  done
}

checkbox() {
  if [[ "$1" == "true" ]]; then
    printf '[x]'
  else
    printf '[ ]'
  fi
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      exit 0
      ;;
  esac

  validate_date_stamp
  validate_run_label
  validate_enums
  require_non_empty "$TARGET_ENVIRONMENT" "TARGET_ENVIRONMENT"
  require_non_empty "$OPERATOR" "OPERATOR"

  if [[ "$RESTORE_STATUS" == "pass" ]]; then
    require_non_empty "$S3_BUCKET" "S3_BUCKET"
    require_non_empty "$S3_REGION" "S3_REGION"
    require_non_empty "$S3_PREFIX" "S3_PREFIX"
    require_non_empty "$ENCRYPTION_MODE" "ENCRYPTION_MODE"
    if [[ "$ENCRYPTION_MODE" == "SSE-KMS" ]]; then
      require_non_empty "$KMS_KEY_ID" "KMS_KEY_ID"
    fi
    require_non_empty "$DECISION_RECORD_FILE" "DECISION_RECORD_FILE"
    require_non_empty "$READINESS_RECORD_FILE" "READINESS_RECORD_FILE"
    require_non_empty "$BACKUP_LOG_FILE" "BACKUP_LOG_FILE"
    require_non_empty "$UPLOAD_LOG_FILE" "UPLOAD_LOG_FILE"
    require_non_empty "$DOWNLOAD_LOG_FILE" "DOWNLOAD_LOG_FILE"
    require_non_empty "$RESTORE_LOG_FILE" "RESTORE_LOG_FILE"
    require_non_empty "$INTEGRITY_REPORT_JSON" "INTEGRITY_REPORT_JSON"
  fi

  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  mkdir -p "$OUT_DIR"

  if [[ -n "$DECISION_RECORD_FILE" ]]; then
    DECISION_RECORD_FILE="$(resolve_absolute_path "$DECISION_RECORD_FILE")"
    require_file "$DECISION_RECORD_FILE" "decision record file"
  fi
  if [[ -n "$READINESS_RECORD_FILE" ]]; then
    READINESS_RECORD_FILE="$(resolve_absolute_path "$READINESS_RECORD_FILE")"
    require_file "$READINESS_RECORD_FILE" "readiness record file"
  fi
  if [[ -n "$BACKUP_LOG_FILE" ]]; then
    BACKUP_LOG_FILE="$(resolve_absolute_path "$BACKUP_LOG_FILE")"
    require_non_empty_file "$BACKUP_LOG_FILE" "backup log file"
  fi
  if [[ -n "$UPLOAD_LOG_FILE" ]]; then
    UPLOAD_LOG_FILE="$(resolve_absolute_path "$UPLOAD_LOG_FILE")"
    require_non_empty_file "$UPLOAD_LOG_FILE" "upload log file"
  fi
  if [[ -n "$DOWNLOAD_LOG_FILE" ]]; then
    DOWNLOAD_LOG_FILE="$(resolve_absolute_path "$DOWNLOAD_LOG_FILE")"
    require_non_empty_file "$DOWNLOAD_LOG_FILE" "download log file"
  fi
  if [[ -n "$RESTORE_LOG_FILE" ]]; then
    RESTORE_LOG_FILE="$(resolve_absolute_path "$RESTORE_LOG_FILE")"
    require_non_empty_file "$RESTORE_LOG_FILE" "restore log file"
  fi
  if [[ -n "$INTEGRITY_REPORT_JSON" ]]; then
    INTEGRITY_REPORT_JSON="$(resolve_absolute_path "$INTEGRITY_REPORT_JSON")"
    require_non_empty_file "$INTEGRITY_REPORT_JSON" "integrity report json"
  fi

  local decision_complete=false readiness_complete=false logs_complete=false integrity_complete=false
  local backup_log_complete=false upload_log_complete=false download_log_complete=false restore_log_complete=false
  local decision_missing="not_checked"
  local decision_mismatches="not_checked"
  local counts_match="not_checked" amounts_match="not_checked" references_match="not_checked" files_match="not_checked"

  if [[ -n "$DECISION_RECORD_FILE" ]]; then
    if decision_missing="$(decision_missing_fields "$DECISION_RECORD_FILE")"; then
      decision_missing="none"
    fi
    if decision_mismatches="$(decision_mismatch_fields "$DECISION_RECORD_FILE")"; then
      decision_mismatches="none"
    fi
    if [[ "$decision_missing" == "none" && "$decision_mismatches" == "none" ]]; then
      decision_complete=true
    fi
  fi

  if [[ -n "$READINESS_RECORD_FILE" ]] && readiness_is_pass "$READINESS_RECORD_FILE" && readiness_has_write_probe "$READINESS_RECORD_FILE"; then
    readiness_complete=true
  fi

  if [[ -n "$BACKUP_LOG_FILE" ]]; then
    backup_log_complete=true
  fi
  if [[ -n "$UPLOAD_LOG_FILE" ]]; then
    upload_log_complete=true
  fi
  if [[ -n "$DOWNLOAD_LOG_FILE" ]]; then
    download_log_complete=true
  fi
  if [[ -n "$RESTORE_LOG_FILE" ]]; then
    restore_log_complete=true
  fi
  if [[ "$backup_log_complete" == "true" && "$upload_log_complete" == "true" && "$download_log_complete" == "true" && "$restore_log_complete" == "true" ]]; then
    logs_complete=true
  fi

  if [[ -n "$INTEGRITY_REPORT_JSON" ]]; then
    counts_match="$(integrity_value "$INTEGRITY_REPORT_JSON" counts)"
    amounts_match="$(integrity_value "$INTEGRITY_REPORT_JSON" amounts)"
    references_match="$(integrity_value "$INTEGRITY_REPORT_JSON" references)"
    files_match="$(integrity_value "$INTEGRITY_REPORT_JSON" files)"
    if [[ "$counts_match" == "true" && "$amounts_match" == "true" && "$references_match" == "true" && "$files_match" == "true" ]]; then
      integrity_complete=true
    fi
  fi

  if [[ "$RESTORE_STATUS" == "pass" ]]; then
    [[ "$decision_complete" == "true" ]] || die "RESTORE_STATUS=pass requires finalized and matching decision record fields (missing: $decision_missing; mismatches: $decision_mismatches)"
    [[ "$readiness_complete" == "true" ]] || die "RESTORE_STATUS=pass requires S3 readiness record with summaryStatus=pass and CHECK_WRITE=1"
    [[ "$logs_complete" == "true" ]] || die "RESTORE_STATUS=pass requires backup/upload/download/restore logs"
    [[ "$integrity_complete" == "true" ]] || die "RESTORE_STATUS=pass requires integrity checks to be true (counts=$counts_match amounts=$amounts_match references=$references_match files=$files_match)"
  fi

  local output_file
  output_file="$(resolve_output_file)"

  if ! (
    set -o noclobber
    {
      local code_tick='`'
      echo "# S3 backup/restore 実証跡"
      echo
      echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf -- '- targetEnvironment: %s%s%s\n' "$code_tick" "$TARGET_ENVIRONMENT" "$code_tick"
      printf -- '- operator: %s%s%s\n' "$code_tick" "$OPERATOR" "$code_tick"
      printf -- '- restoreStatus: %s%s%s\n' "$code_tick" "$RESTORE_STATUS" "$code_tick"
      printf -- '- s3Bucket: %s%s%s\n' "$code_tick" "${S3_BUCKET:-not_provided}" "$code_tick"
      printf -- '- s3Region: %s%s%s\n' "$code_tick" "${S3_REGION:-not_provided}" "$code_tick"
      printf -- '- s3Prefix: %s%s%s\n' "$code_tick" "${S3_PREFIX:-not_provided}" "$code_tick"
      printf -- '- encryptionMode: %s%s%s\n' "$code_tick" "${ENCRYPTION_MODE:-not_provided}" "$code_tick"
      printf -- '- kmsKeyId: %s%s%s\n' "$code_tick" "${KMS_KEY_ID:-not_provided}" "$code_tick"
      echo "- branch: $(git -C "$ROOT_DIR" branch --show-current)"
      echo "- commit: $(git -C "$ROOT_DIR" rev-parse HEAD)"
      printf -- '- decisionRecordFile: %s%s%s\n' "$code_tick" "$(format_source_path "$DECISION_RECORD_FILE")" "$code_tick"
      printf -- '- readinessRecordFile: %s%s%s\n' "$code_tick" "$(format_source_path "$READINESS_RECORD_FILE")" "$code_tick"
      printf -- '- backupLogFile: %s%s%s\n' "$code_tick" "$(format_source_path "$BACKUP_LOG_FILE")" "$code_tick"
      printf -- '- uploadLogFile: %s%s%s\n' "$code_tick" "$(format_source_path "$UPLOAD_LOG_FILE")" "$code_tick"
      printf -- '- downloadLogFile: %s%s%s\n' "$code_tick" "$(format_source_path "$DOWNLOAD_LOG_FILE")" "$code_tick"
      printf -- '- restoreLogFile: %s%s%s\n' "$code_tick" "$(format_source_path "$RESTORE_LOG_FILE")" "$code_tick"
      printf -- '- integrityReportJson: %s%s%s\n' "$code_tick" "$(format_source_path "$INTEGRITY_REPORT_JSON")" "$code_tick"
      echo "- decisionMissingFields: $decision_missing"
      echo "- decisionMismatchFields: $decision_mismatches"
      echo "- countsMatch: $counts_match"
      echo "- amountsMatch: $amounts_match"
      echo "- referencesMatch: $references_match"
      echo "- filesMatch: $files_match"
      echo
      echo "## #544 / #1875 completion gate"
      echo
      printf -- '- %s S3 bucket / region / prefix / encryption / IAM / lifecycle / restore responsibility are finalized and match the supplied environment in the decision record\n' "$(checkbox "$decision_complete")"
      printf -- '- %s S3 readiness passed with a write/delete probe (%sCHECK_WRITE=1%s)\n' "$(checkbox "$readiness_complete")" "$code_tick" "$code_tick"
      printf -- '- %s backup -> upload -> download -> restore logs are captured\n' "$(checkbox "$logs_complete")"
      printf -- '- %s post-restore counts, amounts, references, and required files match\n' "$(checkbox "$integrity_complete")"
      echo
      echo "## Required operation scope"
      echo
      printf -- '- %s backup: %sscripts/backup-prod.sh backup%s or environment-specific equivalent\n' "$(checkbox "$backup_log_complete")" "$code_tick" "$code_tick"
      printf -- '- %s upload: %sscripts/backup-prod.sh upload%s or backup command with S3 upload enabled\n' "$(checkbox "$upload_log_complete")" "$code_tick" "$code_tick"
      printf -- '- %s download: %sscripts/backup-prod.sh download%s from S3\n' "$(checkbox "$download_log_complete")" "$code_tick" "$code_tick"
      printf -- '- %s restore: %sRESTORE_CONFIRM=1 scripts/backup-prod.sh restore%s into a verification database/environment\n' "$(checkbox "$restore_log_complete")" "$code_tick" "$code_tick"
      printf -- '- %s integrity: restored row counts, monetary totals, referential checks, and required files/assets match the source snapshot\n' "$(checkbox "$integrity_complete")"
      echo
      echo "## Notes"
      echo
      if [[ -n "$TRIAL_NOTES" ]]; then
        printf '%s\n' "$TRIAL_NOTES"
      else
        echo "-"
      fi
    } > "$output_file"
  ); then
    die "failed to write output file without overwrite: $output_file"
  fi

  log "wrote: $output_file"
}

main "$@"
