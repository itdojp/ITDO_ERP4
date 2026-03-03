#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
REPORT_SOURCE="${REPORT_SOURCE:-}"

usage() {
  cat <<USAGE
Usage:
  LOG_DIR=tmp/migration/logs/po-real-YYYYMMDD-HHMMSS ./scripts/record-po-migration-rehearsal.sh

Optional env:
  LOG_DIR=...         # default: latest tmp/migration/logs/po-real-*
  OUT_DIR=...         # default: docs/test-results (relative path is resolved from repo root)
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...
  REPORT_SOURCE=...   # default: <LOG_DIR>/rehearsal-report.md

Validation:
- DATE_STAMP must be a valid calendar date (YYYY-MM-DD)
- RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$
- existing output file is never overwritten
USAGE
}

die() {
  echo "[record-po-migration-rehearsal][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[record-po-migration-rehearsal] $*"
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
  local parsed
  parsed=""
  if parsed="$(date -d "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  elif parsed="$(date -j -f '%Y-%m-%d' "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  else
    parsed=""
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

find_latest_log_dir() {
  local latest
  latest="$(ls -1dt "$ROOT_DIR"/tmp/migration/logs/po-real-* 2>/dev/null | head -n 1 || true)"
  if [[ -z "$latest" ]]; then
    die "no rehearsal log directory found under tmp/migration/logs/"
  fi
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file="$OUT_DIR/${DATE_STAMP}-po-migration-rehearsal-${RUN_LABEL}.md"
  if [[ -n "$RUN_LABEL" ]]; then
    if [[ -e "$output_file" ]]; then
      die "output file already exists: $output_file"
    fi
    printf '%s\n' "$output_file"
    return
  fi
  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-po-migration-rehearsal-r${n}.md"
    if [[ ! -f "$output_file" ]]; then
      printf '%s\n' "$output_file"
      return
    fi
    n=$((n + 1))
  done
}

main() {
  validate_date_stamp
  validate_run_label
  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"

  if [[ -z "$LOG_DIR" ]]; then
    LOG_DIR="$(find_latest_log_dir)"
  else
    LOG_DIR="$(resolve_absolute_path "$LOG_DIR")"
  fi

  if [[ ! -d "$LOG_DIR" ]]; then
    die "log directory not found: $LOG_DIR"
  fi

  mkdir -p "$OUT_DIR"
  local source_report="$REPORT_SOURCE"
  if [[ -z "$source_report" ]]; then
    source_report="$LOG_DIR/rehearsal-report.md"
  else
    source_report="$(resolve_absolute_path "$source_report")"
  fi

  if [[ ! -f "$source_report" ]]; then
    if ! command -v node >/dev/null 2>&1; then
      die "report file missing and node command not found: $source_report"
    fi
    node "$ROOT_DIR/scripts/generate-po-migration-report.mjs" \
      --log-dir="$LOG_DIR" \
      --output="$source_report"
  fi

  local output_file
  output_file="$(resolve_output_file)"

  if ! (
    set -o noclobber
    {
      echo "# PO移行リハーサル記録"
      echo
      echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "- sourceLogDir: \`$LOG_DIR\`"
      echo "- sourceReport: \`$source_report\`"
      echo "- branch: $(git -C "$ROOT_DIR" branch --show-current)"
      echo "- commit: $(git -C "$ROOT_DIR" rev-parse --short HEAD)"
      echo
      cat "$source_report"
    } > "$output_file"
  ); then
    die "failed to write output file without overwrite: $output_file"
  fi

  log "wrote: $output_file"
}

main "$@"
