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
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...
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

  mkdir -p "$LOG_DIR"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  LOG_FILE="$LOG_DIR/backup-s3-readiness-${timestamp}.log"

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
  local warnings errors summary_status

  warnings="$(grep -c "\\[backup-s3-preflight\\]\\[WARN\\]" "$log_file" || true)"
  errors="$(grep -c "\\[backup-s3-preflight\\]\\[ERROR\\]" "$log_file" || true)"

  summary_status="fail"
  if grep -q "readiness check passed" "$log_file"; then
    summary_status="pass"
  elif grep -q "completed with" "$log_file"; then
    summary_status="warn"
  fi

  if [[ -n "$check_status" && "$check_status" != "0" ]]; then
    summary_status="fail"
  fi

  {
    echo "# S3バックアップ Readiness 記録"
    echo
    echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- sourceLogFile: \`$log_file\`"
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
