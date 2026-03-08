#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
LOG_DIR="${LOG_DIR:-}"
REPORT_FROM="${REPORT_FROM:-}"
REPORT_TO="${REPORT_TO:-}"
FROM_PRESET="${FROM_PRESET:-phase2_core}"
TO_PRESET="${TO_PRESET:-phase3_strict}"
READINESS_SCRIPT="${READINESS_SCRIPT:-$ROOT_DIR/scripts/report-action-policy-phase3-readiness.mjs}"
FALLBACK_SCRIPT="${FALLBACK_SCRIPT:-$ROOT_DIR/scripts/report-action-policy-fallback-allowed.mjs}"
READINESS_RUNNER="${READINESS_RUNNER:-$ROOT_DIR/scripts/run-and-record-action-policy-phase3-readiness.sh}"
CUTOVER_RECORD_SCRIPT="${CUTOVER_RECORD_SCRIPT:-$ROOT_DIR/scripts/record-action-policy-phase3-cutover.sh}"

usage() {
  cat <<USAGE
Usage:
  ./scripts/run-and-record-action-policy-phase3-trial.sh

Optional env:
  OUT_DIR=...                # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...
  LOG_DIR=...                # passed to readiness runner
  REPORT_FROM=...            # passed to readiness runner
  REPORT_TO=...              # passed to readiness runner
  FROM_PRESET=phase2_core
  TO_PRESET=phase3_strict
  READINESS_SCRIPT=...       # passed to readiness runner
  FALLBACK_SCRIPT=...        # passed to readiness runner
  READINESS_RUNNER=...       # default: scripts/run-and-record-action-policy-phase3-readiness.sh
  CUTOVER_RECORD_SCRIPT=...  # default: scripts/record-action-policy-phase3-cutover.sh

This wrapper generates both:
  - docs/test-results/YYYY-MM-DD-action-policy-phase3-readiness-<RUN_LABEL>.md
  - docs/test-results/YYYY-MM-DD-action-policy-phase3-cutover-<RUN_LABEL>.md
with the same run label so the readiness and cutover records stay paired.
USAGE
}

die() {
  echo "[run-and-record-action-policy-phase3-trial][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[run-and-record-action-policy-phase3-trial] $*"
}

resolve_absolute_path() {
  local input="$1"
  if [[ "$input" = /* ]]; then
    printf '%s\n' "$input"
  else
    printf '%s\n' "$ROOT_DIR/$input"
  fi
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

require_file() {
  local file_path="$1"
  local label="$2"
  if [[ ! -f "$file_path" ]]; then
    die "${label} not found: $file_path"
  fi
}

resolve_run_label() {
  if [[ -n "$RUN_LABEL" ]]; then
    printf '%s\n' "$RUN_LABEL"
    return
  fi

  local n=1
  while true; do
    local candidate="r${n}"
    local readiness_path="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-readiness-${candidate}.md"
    local cutover_path="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-cutover-${candidate}.md"
    if [[ ! -e "$readiness_path" && ! -e "$cutover_path" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
    n=$((n + 1))
  done
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

  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  READINESS_RUNNER="$(resolve_absolute_path "$READINESS_RUNNER")"
  CUTOVER_RECORD_SCRIPT="$(resolve_absolute_path "$CUTOVER_RECORD_SCRIPT")"
  READINESS_SCRIPT="$(resolve_absolute_path "$READINESS_SCRIPT")"
  FALLBACK_SCRIPT="$(resolve_absolute_path "$FALLBACK_SCRIPT")"
  if [[ -n "$LOG_DIR" ]]; then
    LOG_DIR="$(resolve_absolute_path "$LOG_DIR")"
  fi
  mkdir -p "$OUT_DIR"

  require_file "$READINESS_RUNNER" "readiness runner"
  require_file "$CUTOVER_RECORD_SCRIPT" "cutover record script"

  local resolved_run_label
  resolved_run_label="$(resolve_run_label)"
  local readiness_record_file="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-readiness-${resolved_run_label}.md"

  log "using run label: ${resolved_run_label}"

  DATE_STAMP="$DATE_STAMP" \
  RUN_LABEL="$resolved_run_label" \
  OUT_DIR="$OUT_DIR" \
  LOG_DIR="$LOG_DIR" \
  REPORT_FROM="$REPORT_FROM" \
  REPORT_TO="$REPORT_TO" \
  READINESS_SCRIPT="$READINESS_SCRIPT" \
  FALLBACK_SCRIPT="$FALLBACK_SCRIPT" \
    "$READINESS_RUNNER"

  require_file "$readiness_record_file" "generated readiness record"

  DATE_STAMP="$DATE_STAMP" \
  RUN_LABEL="$resolved_run_label" \
  OUT_DIR="$OUT_DIR" \
  READINESS_RECORD_FILE="$readiness_record_file" \
  FROM_PRESET="$FROM_PRESET" \
  TO_PRESET="$TO_PRESET" \
    "$CUTOVER_RECORD_SCRIPT"

  log "paired readiness record: $readiness_record_file"
  log "paired cutover record: $OUT_DIR/${DATE_STAMP}-action-policy-phase3-cutover-${resolved_run_label}.md"
}

main "$@"
