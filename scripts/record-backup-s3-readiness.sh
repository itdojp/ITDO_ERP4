#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${LOG_FILE:-}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/tmp/backup-s3-readiness}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
RUN_CHECK="${RUN_CHECK:-0}"
FAIL_ON_CHECK="${FAIL_ON_CHECK:-0}"
CHECK_SCRIPT="${CHECK_SCRIPT:-$ROOT_DIR/scripts/check-backup-s3-readiness.sh}"

check_status=""

usage() {
  cat <<USAGE
Usage:
  LOG_FILE=tmp/backup-s3-readiness/backup-s3-readiness-YYYYMMDD-HHMMSS.log \
    ./scripts/record-backup-s3-readiness.sh

Optional env:
  LOG_FILE=...       # default: latest tmp/backup-s3-readiness/*.log
  LOG_DIR=...        # default: tmp/backup-s3-readiness
  OUT_DIR=...        # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD   # valid calendar date
  RUN_LABEL=r1|r2...      # [A-Za-z0-9][A-Za-z0-9._-]*
  RUN_CHECK=1        # run check-backup-s3-readiness.sh and capture log
  FAIL_ON_CHECK=1    # when RUN_CHECK=1, return non-zero if readiness check failed
  CHECK_SCRIPT=...   # default: scripts/check-backup-s3-readiness.sh
USAGE
}

log() {
  echo "[record-backup-s3-readiness] $*"
}

die() {
  echo "[record-backup-s3-readiness][ERROR] $*" >&2
  exit 1
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
  case "$input" in
    "$ROOT_DIR"/*)
      printf '%s\n' "${input#"$ROOT_DIR"/}"
      ;;
    *)
      printf '%s\n' "$input"
      ;;
  esac
}

max_int() {
  local max=0
  local value
  for value in "$@"; do
    if [[ "$value" =~ ^[0-9]+$ ]] && (( value > max )); then
      max="$value"
    fi
  done
  printf '%s\n' "$max"
}

extract_legacy_summary_warning_count() {
  local log_file="$1"
  local count
  count="$(
    grep -Eo '(completed|failed) with [0-9]+ warning\(s\)' "$log_file" \
      | grep -Eo '[0-9]+' \
      | tail -n 1 || true
  )"
  if [[ "$count" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$count"
  else
    printf '0\n'
  fi
}

extract_machine_summary_line() {
  local log_file="$1"
  grep -E '\[backup-s3-preflight\] SUMMARY ' "$log_file" | tail -n 1 || true
}

extract_machine_summary_field() {
  local summary_line="$1"
  local key="$2"
  local token
  for token in $summary_line; do
    case "$token" in
      "${key}"=*)
        printf '%s\n' "${token#*=}"
        return 0
        ;;
    esac
  done
  return 1
}

has_failed_summary() {
  local log_file="$1"
  grep -Eq 'failed with [0-9]+ warning\(s\)|SUMMARY status=fail' "$log_file"
}

validate_date_stamp() {
  if [[ ! "$DATE_STAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    die "DATE_STAMP must be YYYY-MM-DD (got: ${DATE_STAMP})"
  fi

  local normalized
  normalized=""
  if normalized="$(date -u -d "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  elif normalized="$(date -j -u -f '%Y-%m-%d' "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  else
    normalized=""
  fi
  if [[ "$normalized" != "$DATE_STAMP" ]]; then
    die "DATE_STAMP is not a valid calendar date (got: ${DATE_STAMP})"
  fi
}

validate_run_label() {
  if [[ -z "$RUN_LABEL" ]]; then
    return 0
  fi
  if [[ ! "$RUN_LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    die "RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$ (got: ${RUN_LABEL})"
  fi
}

find_latest_log_file() {
  local latest
  latest="$(ls -1t "$LOG_DIR"/backup-s3-readiness-*.log 2>/dev/null | head -n 1 || true)"
  if [[ -z "$latest" ]]; then
    die "no log file found under: $LOG_DIR"
  fi
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file
  if [[ -n "$RUN_LABEL" ]]; then
    output_file="$OUT_DIR/${DATE_STAMP}-backup-s3-readiness-${RUN_LABEL}.md"
    printf '%s\n' "$output_file"
    return
  fi

  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-backup-s3-readiness-r${n}.md"
    if [[ ! -f "$output_file" ]]; then
      printf '%s\n' "$output_file"
      return
    fi
    n=$((n + 1))
  done
}

run_check_and_capture() {
  if [[ ! -f "$CHECK_SCRIPT" ]]; then
    die "check script not found: $CHECK_SCRIPT"
  fi

  if [[ -z "$LOG_FILE" ]]; then
    mkdir -p "$LOG_DIR"
    local timestamp
    timestamp="$(date +%Y%m%d-%H%M%S)"
    LOG_FILE="$LOG_DIR/backup-s3-readiness-${timestamp}.log"
  else
    LOG_FILE="$(resolve_absolute_path "$LOG_FILE")"
    mkdir -p "$(dirname "$LOG_FILE")"
  fi

  log "running check script: $CHECK_SCRIPT"
  set +e
  "$CHECK_SCRIPT" 2>&1 | tee "$LOG_FILE"
  check_status="${PIPESTATUS[0]}"
  set -e
  log "captured log: $LOG_FILE"
}

write_report() {
  local log_file="$1"
  local output_file="$2"
  local source_log
  source_log="$(format_source_path "$log_file")"
  local warnings errors summary_status summary_source
  local machine_summary_line machine_summary_status
  local machine_warning_count machine_error_count
  local warnings_by_lines warnings_by_summary
  local errors_by_lines errors_by_summary errors_by_status

  warnings_by_lines="$(grep -c "\\[backup-s3-preflight\\]\\[WARN\\]" "$log_file" || true)"
  errors_by_lines="$(grep -c "\\[backup-s3-preflight\\]\\[ERROR\\]" "$log_file" || true)"
  machine_summary_line="$(extract_machine_summary_line "$log_file")"
  machine_summary_status=""
  machine_warning_count=""
  machine_error_count=""
  summary_source="legacy-log-scan"

  if [[ -n "$machine_summary_line" ]]; then
    machine_summary_status="$(extract_machine_summary_field "$machine_summary_line" "status" || true)"
    machine_warning_count="$(extract_machine_summary_field "$machine_summary_line" "warning_count" || true)"
    machine_error_count="$(extract_machine_summary_field "$machine_summary_line" "error_count" || true)"
    summary_source="summary-line"
  fi

  if [[ "$machine_warning_count" =~ ^[0-9]+$ ]]; then
    warnings_by_summary="$machine_warning_count"
  else
    warnings_by_summary="$(extract_legacy_summary_warning_count "$log_file")"
  fi

  if [[ "$machine_error_count" =~ ^[0-9]+$ ]]; then
    errors_by_summary="$machine_error_count"
  else
    errors_by_summary=0
  fi
  errors_by_status=0

  if [[ "$errors_by_summary" == "0" ]] && has_failed_summary "$log_file"; then
    errors_by_summary=1
  fi
  if [[ -n "$check_status" && "$check_status" != "0" ]]; then
    errors_by_status=1
  fi

  warnings="$(max_int "$warnings_by_lines" "$warnings_by_summary")"
  errors="$(max_int "$errors_by_lines" "$errors_by_summary" "$errors_by_status")"

  summary_status=""
  case "$machine_summary_status" in
    pass|warn|fail)
      summary_status="$machine_summary_status"
      ;;
  esac

  if [[ -z "$summary_status" ]]; then
    summary_status="fail"
    if grep -q "readiness check passed" "$log_file"; then
      summary_status="pass"
    elif grep -q "completed with" "$log_file"; then
      summary_status="warn"
    fi
  fi

  if [[ -n "$check_status" && "$check_status" != "0" ]]; then
    summary_status="fail"
  fi

  {
    echo "# S3バックアップ Readiness 記録"
    echo
    echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- sourceLogFile: \`$source_log\`"
    echo "- summarySource: ${summary_source}"
    echo "- summaryStatus: ${summary_status}"
    echo "- warningCount: ${warnings}"
    echo "- errorCount: ${errors}"
    if [[ -n "$check_status" ]]; then
      echo "- checkExitCode: ${check_status}"
    fi
    echo "- branch: $(git -C "$ROOT_DIR" branch --show-current)"
    echo "- commit: $(git -C "$ROOT_DIR" rev-parse --short HEAD)"
    echo
    echo "## ログ（全文）"
    echo
    echo '```text'
    cat "$log_file"
    echo '```'
  } > "$output_file"

  log "wrote: $output_file"
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  validate_date_stamp
  validate_run_label

  if [[ "$RUN_CHECK" != "0" && "$RUN_CHECK" != "1" ]]; then
    die "RUN_CHECK must be 0|1"
  fi
  if [[ "$FAIL_ON_CHECK" != "0" && "$FAIL_ON_CHECK" != "1" ]]; then
    die "FAIL_ON_CHECK must be 0|1"
  fi

  if [[ "$RUN_CHECK" == "1" ]]; then
    run_check_and_capture
  fi

  if [[ -z "$LOG_FILE" ]]; then
    LOG_FILE="$(find_latest_log_file)"
  else
    LOG_FILE="$(resolve_absolute_path "$LOG_FILE")"
  fi

  if [[ ! -f "$LOG_FILE" ]]; then
    die "log file not found: $LOG_FILE"
  fi

  mkdir -p "$OUT_DIR"
  local output_file
  output_file="$(resolve_output_file)"

  write_report "$LOG_FILE" "$output_file"

  if [[ "$RUN_CHECK" == "1" && "$FAIL_ON_CHECK" == "1" && "$check_status" != "0" ]]; then
    exit "$check_status"
  fi
}

main "$@"
