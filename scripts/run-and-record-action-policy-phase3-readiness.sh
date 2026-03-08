#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/tmp/action-policy-phase3-readiness/run-$(date +%Y%m%d-%H%M%S)}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
# Optional explicit report window. If omitted, a single 24h window ending at "now" is captured once and reused.
REPORT_TO="${REPORT_TO:-}"
REPORT_FROM="${REPORT_FROM:-}"
READINESS_SCRIPT="${READINESS_SCRIPT:-$ROOT_DIR/scripts/report-action-policy-phase3-readiness.mjs}"
FALLBACK_SCRIPT="${FALLBACK_SCRIPT:-$ROOT_DIR/scripts/report-action-policy-fallback-allowed.mjs}"

die() {
  echo "[run-and-record-action-policy-phase3-readiness][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[run-and-record-action-policy-phase3-readiness] $*"
}

resolve_absolute_path() {
  local input="$1"
  if [[ "$input" = /* ]]; then
    printf '%s\n' "$input"
  else
    printf '%s\n' "$ROOT_DIR/$input"
  fi
}

require_file() {
  local file_path="$1"
  local label="$2"
  if [[ ! -f "$file_path" ]]; then
    die "${label} not found: $file_path"
  fi
}

resolve_report_window() {
  if [[ -z "$REPORT_TO" ]]; then
    REPORT_TO="$(node -e 'process.stdout.write(new Date().toISOString())')"
  fi
  if [[ -z "$REPORT_FROM" ]]; then
    REPORT_FROM="$(node -e "const to = new Date(process.argv[1]); process.stdout.write(new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString())" "$REPORT_TO")"
  fi
}

main() {
  if ! command -v node >/dev/null 2>&1; then
    die "node command not found"
  fi

  LOG_DIR="$(resolve_absolute_path "$LOG_DIR")"
  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  READINESS_SCRIPT="$(resolve_absolute_path "$READINESS_SCRIPT")"
  FALLBACK_SCRIPT="$(resolve_absolute_path "$FALLBACK_SCRIPT")"

  require_file "$READINESS_SCRIPT" "readiness script"
  require_file "$FALLBACK_SCRIPT" "fallback script"

  resolve_report_window

  mkdir -p "$LOG_DIR"
  mkdir -p "$OUT_DIR"

  log "writing logs to: $LOG_DIR"
  log "capturing report window: $REPORT_FROM -> $REPORT_TO"
  node "$READINESS_SCRIPT" --from="$REPORT_FROM" --to="$REPORT_TO" --format=text > "$LOG_DIR/phase3-readiness.txt"
  node "$READINESS_SCRIPT" --from="$REPORT_FROM" --to="$REPORT_TO" --format=json > "$LOG_DIR/phase3-readiness.json"
  node "$FALLBACK_SCRIPT" --from="$REPORT_FROM" --to="$REPORT_TO" --format=text > "$LOG_DIR/fallback-report.txt"
  node "$FALLBACK_SCRIPT" --from="$REPORT_FROM" --to="$REPORT_TO" --format=json > "$LOG_DIR/fallback-report.json"

  DATE_STAMP="$DATE_STAMP" \
  RUN_LABEL="$RUN_LABEL" \
  LOG_DIR="$LOG_DIR" \
  OUT_DIR="$OUT_DIR" \
    "$ROOT_DIR/scripts/record-action-policy-phase3-readiness.sh"
}

main "$@"
