#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_DIR="${INPUT_DIR:-}"
INPUT_FORMAT="${INPUT_FORMAT:-csv}"
ONLY="${ONLY:-}"
APPLY="${APPLY:-0}"
RUN_INTEGRITY="${RUN_INTEGRITY:-0}"
RUN_PREFLIGHT="${RUN_PREFLIGHT:-1}"
PREFLIGHT_STRICT="${PREFLIGHT_STRICT:-1}"
GENERATE_REPORT="${GENERATE_REPORT:-1}"
INTEGRITY_SQL="${INTEGRITY_SQL:-$ROOT_DIR/scripts/checks/migration-po-integrity.sql}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/tmp/migration/logs/po-real-$(date +%Y%m%d-%H%M%S)}"
REPORT_FILE="${REPORT_FILE:-}"
INPUT_DIR_RESOLVED=""

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
  RUN_PREFLIGHT=1      # run input file preflight before migrate-po.ts (default: 1)
  PREFLIGHT_STRICT=1   # pass-through to preflight STRICT (default: 1)
  GENERATE_REPORT=1    # generate markdown report into LOG_DIR (default: 1)
  REPORT_FILE=...      # default: LOG_DIR/rehearsal-report.md
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

resolve_absolute_path() {
  local input="$1"
  if [[ "$input" = /* ]]; then
    printf '%s\n' "$input"
  else
    printf '%s\n' "$ROOT_DIR/$input"
  fi
}

strip_prisma_url_params() {
  local raw="$1"
  local base="${raw%%\?*}"
  if [[ "$raw" != *\?* ]]; then
    printf '%s\n' "$raw"
    return
  fi

  local query="${raw#*\?}"
  local filtered=()
  local pair key
  IFS='&' read -r -a parts <<< "$query"
  for pair in "${parts[@]}"; do
    [[ -z "$pair" ]] && continue
    key="${pair%%=*}"
    # Prisma向けのschema/search_path指定は psql では不正オプションになりうるため除外する。
    if [[ "$key" == "schema" || "$key" == "search_path" ]]; then
      continue
    fi
    filtered+=("$pair")
  done

  if (( ${#filtered[@]} == 0 )); then
    printf '%s\n' "$base"
    return
  fi

  local joined
  (
    IFS='&'
    joined="${filtered[*]}"
    printf '%s\n' "${base}?${joined}"
  )
}

ensure_backend_build() {
  local dist_dir="$ROOT_DIR/packages/backend/dist"
  local dist_db="$dist_dir/services/db.js"
  if [[ ! -f "$dist_db" ]]; then
    die "backend build artifacts not found: $dist_db (run 'npm run build --prefix packages/backend' first)"
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
  if [[ "$RUN_PREFLIGHT" != "0" && "$RUN_PREFLIGHT" != "1" ]]; then
    die "RUN_PREFLIGHT must be 0|1"
  fi
  if [[ "$PREFLIGHT_STRICT" != "0" && "$PREFLIGHT_STRICT" != "1" ]]; then
    die "PREFLIGHT_STRICT must be 0|1"
  fi
  if [[ "$GENERATE_REPORT" != "0" && "$GENERATE_REPORT" != "1" ]]; then
    die "GENERATE_REPORT must be 0|1"
  fi

  INPUT_DIR_RESOLVED="$(resolve_absolute_path "$INPUT_DIR")"
  if [[ ! -d "$INPUT_DIR_RESOLVED" ]]; then
    die "input dir not found: $INPUT_DIR_RESOLVED"
  fi
}

run_preflight() {
  local preflight_script="$ROOT_DIR/scripts/check-po-migration-input-readiness.sh"
  if [[ ! -f "$preflight_script" ]]; then
    die "preflight script not found: $preflight_script"
  fi
  log "running preflight: $preflight_script"
  INPUT_DIR="$INPUT_DIR_RESOLVED" \
  INPUT_FORMAT="$INPUT_FORMAT" \
  ONLY="$ONLY" \
  STRICT="$PREFLIGHT_STRICT" \
    "$preflight_script"
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
    "--input-dir=$INPUT_DIR_RESOLVED"
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
  local psql_database_url
  psql_database_url="$(strip_prisma_url_params "$DATABASE_URL")"
  psql "$psql_database_url" -f "$INTEGRITY_SQL" 2>&1 | tee "$log_file"
}

generate_report() {
  local exit_code="$1"
  if [[ "$GENERATE_REPORT" != "1" ]]; then
    return 0
  fi
  if [[ ! -d "$LOG_DIR" ]]; then
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    warn "node command not found; skip report generation"
    return 0
  fi
  local report_file
  report_file="${REPORT_FILE:-$LOG_DIR/rehearsal-report.md}"
  local report_script="$ROOT_DIR/scripts/generate-po-migration-report.mjs"
  if [[ ! -f "$report_script" ]]; then
    warn "report script not found: $report_script"
    return 0
  fi
  node "$report_script" \
    --log-dir="$LOG_DIR" \
    --output="$report_file" \
    --exit-code="$exit_code" || warn "failed to generate report"
  if [[ -f "$report_file" ]]; then
    log "report: $report_file"
  fi
}

warn() {
  echo "[po-migration-rehearsal][WARN] $*" >&2
}

on_exit() {
  local status="$1"
  set +e
  generate_report "$status"
}

trap 'on_exit "$?"' EXIT

main() {
  require_cmd npx
  validate_input
  ensure_backend_build

  mkdir -p "$LOG_DIR"
  local dry_log="$LOG_DIR/dry-run.log"
  local apply_log="$LOG_DIR/apply.log"
  local integrity_log="$LOG_DIR/integrity.log"

  if [[ "$RUN_PREFLIGHT" == "1" ]]; then
    run_preflight
  fi

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
