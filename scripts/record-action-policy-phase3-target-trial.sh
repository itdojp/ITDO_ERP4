#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
TARGET_ENVIRONMENT="${TARGET_ENVIRONMENT:-}"
OPERATOR="${OPERATOR:-}"
TRIAL_STATUS="${TRIAL_STATUS:-}"
ROLLBACK_STATUS="${ROLLBACK_STATUS:-not_tested}"
READINESS_RECORD_FILE="${READINESS_RECORD_FILE:-}"
CUTOVER_RECORD_FILE="${CUTOVER_RECORD_FILE:-}"
OPERATION_RESULTS_FILE="${OPERATION_RESULTS_FILE:-}"
POST_FALLBACK_REPORT_JSON="${POST_FALLBACK_REPORT_JSON:-}"
POST_READINESS_REPORT_JSON="${POST_READINESS_REPORT_JSON:-}"
ROLLBACK_FALLBACK_REPORT_JSON="${ROLLBACK_FALLBACK_REPORT_JSON:-}"
ROLLBACK_READINESS_REPORT_JSON="${ROLLBACK_READINESS_REPORT_JSON:-}"
CUTOVER_AT="${CUTOVER_AT:-}"
ROLLBACK_AT="${ROLLBACK_AT:-}"
TRIAL_NOTES="${TRIAL_NOTES:-}"

usage() {
  cat <<USAGE
Usage:
  TARGET_ENVIRONMENT=staging OPERATOR=alice TRIAL_STATUS=pass \\
  READINESS_RECORD_FILE=docs/test-results/YYYY-MM-DD-action-policy-phase3-readiness-rN.md \\
  CUTOVER_RECORD_FILE=docs/test-results/YYYY-MM-DD-action-policy-phase3-cutover-rN.md \\
  OPERATION_RESULTS_FILE=docs/test-results/.../manual-ops.md \\
  POST_FALLBACK_REPORT_JSON=tmp/.../post-fallback.json \\
  ROLLBACK_STATUS=verified ROLLBACK_FALLBACK_REPORT_JSON=tmp/.../rollback-fallback.json \\
    ./scripts/record-action-policy-phase3-target-trial.sh

Optional env:
  OUT_DIR=...                         # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|target-YYYYMMDD...     # auto-increments rN when omitted
  TARGET_ENVIRONMENT=...              # required
  OPERATOR=...                        # required
  TRIAL_STATUS=pass|failed|blocked     # required
  ROLLBACK_STATUS=verified|failed|not_required|not_tested
  READINESS_RECORD_FILE=...           # default: latest action-policy phase3 readiness record
  CUTOVER_RECORD_FILE=...             # default: latest action-policy phase3 cutover record
  OPERATION_RESULTS_FILE=...          # required when TRIAL_STATUS=pass
  POST_FALLBACK_REPORT_JSON=...       # required when TRIAL_STATUS=pass; uniqueKeys must be 0
  POST_READINESS_REPORT_JSON=...
  ROLLBACK_FALLBACK_REPORT_JSON=...   # required when TRIAL_STATUS=pass and ROLLBACK_STATUS=verified
  ROLLBACK_READINESS_REPORT_JSON=...
  CUTOVER_AT=YYYY-MM-DDTHH:MM:SSZ
  ROLLBACK_AT=YYYY-MM-DDTHH:MM:SSZ
  TRIAL_NOTES='free-form notes'

Validation:
- DATE_STAMP must be a valid calendar date.
- RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$.
- A pass record cannot be written unless target environment, operator, operation results,
  post-cutover fallback JSON, and verified rollback evidence are present.
- A pass record requires post-cutover fallback uniqueKeys to be 0.
- Existing output files are never overwritten.
USAGE
}

die() {
  echo "[record-action-policy-phase3-target-trial][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[record-action-policy-phase3-target-trial] $*"
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
  if [[ "$parsed" != "$DATE_STAMP" ]]; then
    die "DATE_STAMP is not a valid calendar date: $DATE_STAMP"
  fi
}

validate_run_label() {
  if [[ -z "$RUN_LABEL" ]]; then
    return 0
  fi
  if ! [[ "$RUN_LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    die "RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$"
  fi
}

validate_enums() {
  case "$TRIAL_STATUS" in
    pass|failed|blocked) ;;
    "") die "TRIAL_STATUS is required and must be pass, failed, or blocked" ;;
    *) die "TRIAL_STATUS must be pass, failed, or blocked" ;;
  esac
  case "$ROLLBACK_STATUS" in
    verified|failed|not_required|not_tested) ;;
    *) die "ROLLBACK_STATUS must be verified, failed, not_required, or not_tested" ;;
  esac
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

find_latest_record() {
  local pattern="$1"
  local label="$2"
  local matches=()
  local latest=""
  # Intentionally expands the caller-provided glob pattern.
  # shellcheck disable=SC2206
  matches=( $pattern )
  if [[ "${#matches[@]}" -eq 0 ]]; then
    die "no $label found under docs/test-results/"
  fi
  # shellcheck disable=SC2012
  latest="$(ls -1t "${matches[@]}" | head -n 1 || true)"
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file
  if [[ -n "$RUN_LABEL" ]]; then
    output_file="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-target-trial-${RUN_LABEL}.md"
    if [[ -e "$output_file" ]]; then
      die "output file already exists: $output_file"
    fi
    printf '%s\n' "$output_file"
    return
  fi
  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-target-trial-r${n}.md"
    if [[ ! -e "$output_file" ]]; then
      printf '%s\n' "$output_file"
      return
    fi
    n=$((n + 1))
  done
}

json_unique_keys() {
  local file_path="$1"
  node - "$file_path" <<'NODE'
const fs = require('node:fs');
const filePath = process.argv[2];
const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const candidates = [
  parsed?.totals?.uniqueKeys,
  parsed?.totals?.unique_keys,
  parsed?.uniqueKeys,
  parsed?.unique_keys,
];
const value = candidates.find((item) => item !== undefined && item !== null);
if (typeof value !== 'number') {
  console.error(`uniqueKeys not found in ${filePath}`);
  process.exit(2);
}
process.stdout.write(String(value));
NODE
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

  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  mkdir -p "$OUT_DIR"

  if [[ -z "$READINESS_RECORD_FILE" ]]; then
    READINESS_RECORD_FILE="$(find_latest_record "$ROOT_DIR/docs/test-results/*-action-policy-phase3-readiness-*.md" "action policy phase3 readiness record")"
  else
    READINESS_RECORD_FILE="$(resolve_absolute_path "$READINESS_RECORD_FILE")"
  fi
  require_file "$READINESS_RECORD_FILE" "readiness record file"

  if [[ -z "$CUTOVER_RECORD_FILE" ]]; then
    CUTOVER_RECORD_FILE="$(find_latest_record "$ROOT_DIR/docs/test-results/*-action-policy-phase3-cutover-*.md" "action policy phase3 cutover record")"
  else
    CUTOVER_RECORD_FILE="$(resolve_absolute_path "$CUTOVER_RECORD_FILE")"
  fi
  require_file "$CUTOVER_RECORD_FILE" "cutover record file"

  if [[ -n "$OPERATION_RESULTS_FILE" ]]; then
    OPERATION_RESULTS_FILE="$(resolve_absolute_path "$OPERATION_RESULTS_FILE")"
    require_file "$OPERATION_RESULTS_FILE" "operation results file"
  fi
  if [[ -n "$POST_FALLBACK_REPORT_JSON" ]]; then
    POST_FALLBACK_REPORT_JSON="$(resolve_absolute_path "$POST_FALLBACK_REPORT_JSON")"
    require_file "$POST_FALLBACK_REPORT_JSON" "post-cutover fallback report json"
  fi
  if [[ -n "$POST_READINESS_REPORT_JSON" ]]; then
    POST_READINESS_REPORT_JSON="$(resolve_absolute_path "$POST_READINESS_REPORT_JSON")"
    require_file "$POST_READINESS_REPORT_JSON" "post-cutover readiness report json"
  fi
  if [[ -n "$ROLLBACK_FALLBACK_REPORT_JSON" ]]; then
    ROLLBACK_FALLBACK_REPORT_JSON="$(resolve_absolute_path "$ROLLBACK_FALLBACK_REPORT_JSON")"
    require_file "$ROLLBACK_FALLBACK_REPORT_JSON" "rollback fallback report json"
  fi
  if [[ -n "$ROLLBACK_READINESS_REPORT_JSON" ]]; then
    ROLLBACK_READINESS_REPORT_JSON="$(resolve_absolute_path "$ROLLBACK_READINESS_REPORT_JSON")"
    require_file "$ROLLBACK_READINESS_REPORT_JSON" "rollback readiness report json"
  fi

  local post_fallback_unique_keys="not_checked"
  if [[ -n "$POST_FALLBACK_REPORT_JSON" ]]; then
    post_fallback_unique_keys="$(json_unique_keys "$POST_FALLBACK_REPORT_JSON")"
  fi

  if [[ "$TRIAL_STATUS" == "pass" ]]; then
    require_non_empty "$CUTOVER_AT" "CUTOVER_AT"
    require_non_empty "$OPERATION_RESULTS_FILE" "OPERATION_RESULTS_FILE"
    require_non_empty "$POST_FALLBACK_REPORT_JSON" "POST_FALLBACK_REPORT_JSON"
    if [[ "$post_fallback_unique_keys" != "0" ]]; then
      die "TRIAL_STATUS=pass requires post-cutover fallback uniqueKeys to be 0 (actual: $post_fallback_unique_keys)"
    fi
    if [[ "$ROLLBACK_STATUS" != "verified" ]]; then
      die "TRIAL_STATUS=pass requires ROLLBACK_STATUS=verified for #1426 rollback evidence"
    fi
    require_non_empty "$ROLLBACK_AT" "ROLLBACK_AT"
    require_non_empty "$ROLLBACK_FALLBACK_REPORT_JSON" "ROLLBACK_FALLBACK_REPORT_JSON"
  fi

  local output_file
  output_file="$(resolve_output_file)"

  local trial_pass rollback_verified post_fallback_zero
  [[ "$TRIAL_STATUS" == "pass" ]] && trial_pass=true || trial_pass=false
  [[ "$ROLLBACK_STATUS" == "verified" ]] && rollback_verified=true || rollback_verified=false
  [[ "$post_fallback_unique_keys" == "0" ]] && post_fallback_zero=true || post_fallback_zero=false

  if ! (
    set -o noclobber
    {
      local code_tick='`'
      echo "# ActionPolicy phase3 target-environment trial 記録"
      echo
      echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf -- '- targetEnvironment: %s%s%s\n' "$code_tick" "$TARGET_ENVIRONMENT" "$code_tick"
      printf -- '- operator: %s%s%s\n' "$code_tick" "$OPERATOR" "$code_tick"
      printf -- '- trialStatus: %s%s%s\n' "$code_tick" "$TRIAL_STATUS" "$code_tick"
      printf -- '- rollbackStatus: %s%s%s\n' "$code_tick" "$ROLLBACK_STATUS" "$code_tick"
      echo "- branch: $(git -C "$ROOT_DIR" branch --show-current)"
      echo "- commit: $(git -C "$ROOT_DIR" rev-parse HEAD)"
      printf -- '- sourceReadinessRecord: %s%s%s\n' "$code_tick" "$(format_source_path "$READINESS_RECORD_FILE")" "$code_tick"
      printf -- '- sourceCutoverRecord: %s%s%s\n' "$code_tick" "$(format_source_path "$CUTOVER_RECORD_FILE")" "$code_tick"
      printf -- '- operationResultsFile: %s%s%s\n' "$code_tick" "$(format_source_path "$OPERATION_RESULTS_FILE")" "$code_tick"
      printf -- '- postFallbackReportJson: %s%s%s\n' "$code_tick" "$(format_source_path "$POST_FALLBACK_REPORT_JSON")" "$code_tick"
      printf -- '- postReadinessReportJson: %s%s%s\n' "$code_tick" "$(format_source_path "$POST_READINESS_REPORT_JSON")" "$code_tick"
      printf -- '- rollbackFallbackReportJson: %s%s%s\n' "$code_tick" "$(format_source_path "$ROLLBACK_FALLBACK_REPORT_JSON")" "$code_tick"
      printf -- '- rollbackReadinessReportJson: %s%s%s\n' "$code_tick" "$(format_source_path "$ROLLBACK_READINESS_REPORT_JSON")" "$code_tick"
      echo "- cutoverAt: ${CUTOVER_AT:-not_provided}"
      echo "- rollbackAt: ${ROLLBACK_AT:-not_provided}"
      echo "- postFallbackUniqueKeys: $post_fallback_unique_keys"
      echo
      echo "## #1426 completion gate"
      echo
      printf -- '- %s 対象環境で %s%s%s trial / cutover を実施した\n' "$(checkbox "$trial_pass")" "$code_tick" "phase3_strict" "$code_tick"
      printf -- '- %s 主要操作確認結果を operation results file に保存した\n' "$(checkbox "$trial_pass")"
      printf -- '- %s cutover 後 fallback unique keys が 0 件であることを確認した\n' "$(checkbox "$post_fallback_zero")"
      printf -- '- %s %s%s%s rollback 手順を実施または演習し、復旧確認を保存した\n' "$(checkbox "$rollback_verified")" "$code_tick" "phase2_core" "$code_tick"
      echo
      echo "## Required operation scope"
      echo
      printf -- '- [ ] %s%s%s\n' "$code_tick" "invoice:send" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "invoice:mark_paid" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "purchase_order:send" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "expense:submit" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "expense:mark_paid" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "vendor_invoice:submit" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "vendor_invoice:update_lines" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "vendor_invoice:update_allocations" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "*:approve" "$code_tick"
      printf -- '- [ ] %s%s%s\n' "$code_tick" "*:reject" "$code_tick"
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
