#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_DIR="${INPUT_DIR:-}"
INPUT_FORMAT="${INPUT_FORMAT:-csv}"
ONLY="${ONLY:-}"
APPLY="${APPLY:-0}"
RUN_INTEGRITY="${RUN_INTEGRITY:-0}"
INTEGRITY_SQL="${INTEGRITY_SQL:-$ROOT_DIR/scripts/checks/migration-po-integrity.sql}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/tmp/migration/logs/po-real-$(date +%Y%m%d-%H%M%S)}"

usage() {
  cat <<USAGE
Usage:
  INPUT_DIR=tmp/migration/po-real ./scripts/run-po-migration-rehearsal.sh

Required env:
  INPUT_DIR            # CSV/JSON input directory for migrate-po.ts

Optional env:
  INPUT_FORMAT=csv|json (default: csv)
  ONLY=users,projects,...
  APPLY=1              # run --apply after dry-run
  RUN_INTEGRITY=1      # run migration integrity SQL after APPLY=1
  INTEGRITY_SQL=...    # default: scripts/checks/migration-po-integrity.sql
  LOG_DIR=...          # default: tmp/migration/logs/po-real-<timestamp>

Notes:
- RUN_INTEGRITY=1 requires DATABASE_URL and psql command.
- This script wraps scripts/migrate-po.ts and stores logs for issue reports.
USAGE
}

log() {
  echo "[po-migration-rehearsal] $*"
}

die() {
  echo "[po-migration-rehearsal][ERROR] $*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "missing command: $1"
  fi
}

validate_input() {
  if [[ -z "$INPUT_DIR" ]]; then
    usage
    die "INPUT_DIR is required"
  fi
  if [[ "$INPUT_FORMAT" != "csv" && "$INPUT_FORMAT" != "json" ]]; then
    die "INPUT_FORMAT must be csv|json"
  fi
  if [[ "$APPLY" != "0" && "$APPLY" != "1" ]]; then
    die "APPLY must be 0|1"
  fi
  if [[ "$RUN_INTEGRITY" != "0" && "$RUN_INTEGRITY" != "1" ]]; then
    die "RUN_INTEGRITY must be 0|1"
  fi
  if [[ "$RUN_INTEGRITY" == "1" && "$APPLY" != "1" ]]; then
    die "RUN_INTEGRITY=1 requires APPLY=1"
  fi

  local resolved_input
  if [[ "$INPUT_DIR" = /* ]]; then
    resolved_input="$INPUT_DIR"
  else
    resolved_input="$ROOT_DIR/$INPUT_DIR"
  fi
  if [[ ! -d "$resolved_input" ]]; then
    die "input dir not found: $resolved_input"
  fi
}

run_migration() {
  local mode="$1"
  local log_file="$2"

  local cmd=(
    npx
    --prefix "$ROOT_DIR/packages/backend"
    ts-node
    --project "$ROOT_DIR/packages/backend/tsconfig.json"
    "$ROOT_DIR/scripts/migrate-po.ts"
    "--input-dir=$INPUT_DIR"
    "--input-format=$INPUT_FORMAT"
  )

  if [[ -n "$ONLY" ]]; then
    cmd+=("--only=$ONLY")
  fi
  if [[ "$mode" == "apply" ]]; then
    cmd+=(--apply)
  fi

  log "running ${mode}: ${cmd[*]}"
  if [[ "$mode" == "apply" ]]; then
    MIGRATION_CONFIRM=1 "${cmd[@]}" 2>&1 | tee "$log_file"
  else
    "${cmd[@]}" 2>&1 | tee "$log_file"
  fi
}

run_integrity_check() {
  local log_file="$1"
  require_cmd psql
  if [[ -z "${DATABASE_URL:-}" ]]; then
    die "RUN_INTEGRITY=1 requires DATABASE_URL"
  fi
  if [[ ! -f "$INTEGRITY_SQL" ]]; then
    die "integrity SQL not found: $INTEGRITY_SQL"
  fi

  log "running integrity SQL: $INTEGRITY_SQL"
  psql "$DATABASE_URL" -f "$INTEGRITY_SQL" 2>&1 | tee "$log_file"
}

main() {
  require_cmd npx
  validate_input

  mkdir -p "$LOG_DIR"
  local dry_log="$LOG_DIR/dry-run.log"
  local apply_log="$LOG_DIR/apply.log"
  local integrity_log="$LOG_DIR/integrity.log"

  run_migration dry-run "$dry_log"

  if [[ "$APPLY" == "1" ]]; then
    run_migration apply "$apply_log"
  fi

  if [[ "$RUN_INTEGRITY" == "1" ]]; then
    run_integrity_check "$integrity_log"
  fi

  log "completed"
  log "logs: $LOG_DIR"
}

main "$@"
