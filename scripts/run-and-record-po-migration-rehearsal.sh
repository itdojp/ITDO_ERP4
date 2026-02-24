#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/tmp/migration/logs/po-real-$(date +%Y%m%d-%H%M%S)}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
OUT_DIR="${OUT_DIR:-}"
RECORD_ON_FAIL="${RECORD_ON_FAIL:-1}"
RUN_SCRIPT="${RUN_SCRIPT_PATH:-$ROOT_DIR/scripts/run-po-migration-rehearsal.sh}"
RECORD_SCRIPT="${RECORD_SCRIPT_PATH:-$ROOT_DIR/scripts/record-po-migration-rehearsal.sh}"

usage() {
  cat <<USAGE
Usage:
  INPUT_DIR=tmp/migration/po-real INPUT_FORMAT=csv APPLY=1 RUN_INTEGRITY=1 \\
    ./scripts/run-and-record-po-migration-rehearsal.sh

Optional env:
  LOG_DIR=...         # shared log dir for run/record
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...
  OUT_DIR=...         # record output dir (default: docs/test-results)
  RECORD_ON_FAIL=1    # 1: run failure時も記録作成（default）
USAGE
}

log() {
  echo "[run-and-record-po-migration] $*"
}

die() {
  echo "[run-and-record-po-migration][ERROR] $*" >&2
  exit 1
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  if [[ "$RECORD_ON_FAIL" != "0" && "$RECORD_ON_FAIL" != "1" ]]; then
    die "RECORD_ON_FAIL must be 0|1"
  fi
  if [[ ! -f "$RUN_SCRIPT" ]]; then
    die "run script not found: $RUN_SCRIPT"
  fi
  if [[ ! -f "$RECORD_SCRIPT" ]]; then
    die "record script not found: $RECORD_SCRIPT"
  fi

  log "run script: $RUN_SCRIPT"
  log "record script: $RECORD_SCRIPT"
  log "log dir: $LOG_DIR"

  set +e
  LOG_DIR="$LOG_DIR" "$RUN_SCRIPT" "$@"
  run_status=$?
  set -e

  if [[ "$run_status" == "0" || "$RECORD_ON_FAIL" == "1" ]]; then
    log "recording rehearsal report"
    if [[ -n "$OUT_DIR" ]]; then
      LOG_DIR="$LOG_DIR" DATE_STAMP="$DATE_STAMP" RUN_LABEL="$RUN_LABEL" OUT_DIR="$OUT_DIR" "$RECORD_SCRIPT"
    else
      LOG_DIR="$LOG_DIR" DATE_STAMP="$DATE_STAMP" RUN_LABEL="$RUN_LABEL" "$RECORD_SCRIPT"
    fi
  else
    log "skip report recording because run failed and RECORD_ON_FAIL=0"
  fi

  if [[ "$run_status" != "0" ]]; then
    log "run finished with non-zero status: $run_status"
    exit "$run_status"
  fi
}

main "$@"
