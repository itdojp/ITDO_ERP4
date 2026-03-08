#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
RUN_TOKEN_CHECK="${RUN_TOKEN_CHECK:-0}"
TOKEN_STRICT="${TOKEN_STRICT:-1}"
TOKEN_CHECK_SCRIPT="${TOKEN_CHECK_SCRIPT:-$ROOT_DIR/scripts/check-dependabot-alerts-token.sh}"
DEPENDABOT_RECORD_SCRIPT="${DEPENDABOT_RECORD_SCRIPT:-$ROOT_DIR/scripts/record-dependabot-alerts.sh}"
ESLINT_RECORD_SCRIPT="${ESLINT_RECORD_SCRIPT:-$ROOT_DIR/scripts/record-eslint10-readiness.sh}"
DEPENDABOT_CHECK_SCRIPT="${DEPENDABOT_CHECK_SCRIPT:-$ROOT_DIR/scripts/check-dependabot-alerts.sh}"
ESLINT_CHECK_SCRIPT="${ESLINT_CHECK_SCRIPT:-$ROOT_DIR/scripts/check-eslint10-readiness.sh}"
DEPENDABOT_LOG_DIR="${DEPENDABOT_LOG_DIR:-$ROOT_DIR/tmp/dependabot-alerts}"
ESLINT_LOG_DIR="${ESLINT_LOG_DIR:-$ROOT_DIR/tmp/eslint10-readiness}"
DEPENDABOT_FAIL_ON_CHECK="${DEPENDABOT_FAIL_ON_CHECK:-1}"
ESLINT_FAIL_ON_CHECK="${ESLINT_FAIL_ON_CHECK:-0}"

usage() {
  cat <<USAGE
Usage:
  ./scripts/run-and-record-dependency-watch.sh

Optional env:
  OUT_DIR=...                 # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...
  RUN_TOKEN_CHECK=0|1         # default: 0
  TOKEN_STRICT=0|1            # default: 1 (used only when RUN_TOKEN_CHECK=1)
  TOKEN_CHECK_SCRIPT=...      # default: scripts/check-dependabot-alerts-token.sh
  DEPENDABOT_RECORD_SCRIPT=...# default: scripts/record-dependabot-alerts.sh
  ESLINT_RECORD_SCRIPT=...    # default: scripts/record-eslint10-readiness.sh
  DEPENDABOT_CHECK_SCRIPT=... # default: scripts/check-dependabot-alerts.sh
  ESLINT_CHECK_SCRIPT=...     # default: scripts/check-eslint10-readiness.sh
  DEPENDABOT_LOG_DIR=...      # default: tmp/dependabot-alerts
  ESLINT_LOG_DIR=...          # default: tmp/eslint10-readiness
  DEPENDABOT_FAIL_ON_CHECK=0|1# default: 1
  ESLINT_FAIL_ON_CHECK=0|1    # default: 0

This wrapper generates both:
  - docs/test-results/YYYY-MM-DD-dependabot-alerts-<RUN_LABEL>.md
  - docs/test-results/YYYY-MM-DD-eslint10-readiness-<RUN_LABEL>.md
with the same run label so the two operational records stay paired.
USAGE
}

die() {
  echo "[run-and-record-dependency-watch][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[run-and-record-dependency-watch] $*"
}

resolve_absolute_path() {
  local input="$1"
  if [[ "$input" = /* ]]; then
    printf '%s\n' "$input"
  else
    printf '%s\n' "$ROOT_DIR/$input"
  fi
}

validate_binary_flag() {
  local name="$1"
  local value="${!name}"
  case "$value" in
    0|1) ;;
    *) die "${name} must be 0|1 (got: ${value})" ;;
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
    local dependabot_path="$OUT_DIR/${DATE_STAMP}-dependabot-alerts-${candidate}.md"
    local eslint_path="$OUT_DIR/${DATE_STAMP}-eslint10-readiness-${candidate}.md"
    if [[ ! -e "$dependabot_path" && ! -e "$eslint_path" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
    n=$((n + 1))
  done
}

assert_output_pair_available() {
  local run_label="$1"
  local dependabot_path="$OUT_DIR/${DATE_STAMP}-dependabot-alerts-${run_label}.md"
  local eslint_path="$OUT_DIR/${DATE_STAMP}-eslint10-readiness-${run_label}.md"
  if [[ -e "$dependabot_path" ]]; then
    die "dependabot output file already exists: $dependabot_path"
  fi
  if [[ -e "$eslint_path" ]]; then
    die "eslint output file already exists: $eslint_path"
  fi
}

run_optional_token_check() {
  if [[ "$RUN_TOKEN_CHECK" != "1" ]]; then
    return 0
  fi

  require_file "$TOKEN_CHECK_SCRIPT" "token check script"
  log "running token readiness check"
  STRICT="$TOKEN_STRICT" "$TOKEN_CHECK_SCRIPT"
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      exit 0
      ;;
  esac

  validate_binary_flag RUN_TOKEN_CHECK
  validate_binary_flag TOKEN_STRICT
  validate_binary_flag DEPENDABOT_FAIL_ON_CHECK
  validate_binary_flag ESLINT_FAIL_ON_CHECK
  validate_date_stamp
  validate_run_label

  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  TOKEN_CHECK_SCRIPT="$(resolve_absolute_path "$TOKEN_CHECK_SCRIPT")"
  DEPENDABOT_RECORD_SCRIPT="$(resolve_absolute_path "$DEPENDABOT_RECORD_SCRIPT")"
  ESLINT_RECORD_SCRIPT="$(resolve_absolute_path "$ESLINT_RECORD_SCRIPT")"
  DEPENDABOT_CHECK_SCRIPT="$(resolve_absolute_path "$DEPENDABOT_CHECK_SCRIPT")"
  ESLINT_CHECK_SCRIPT="$(resolve_absolute_path "$ESLINT_CHECK_SCRIPT")"
  DEPENDABOT_LOG_DIR="$(resolve_absolute_path "$DEPENDABOT_LOG_DIR")"
  ESLINT_LOG_DIR="$(resolve_absolute_path "$ESLINT_LOG_DIR")"
  mkdir -p "$OUT_DIR"

  require_file "$DEPENDABOT_RECORD_SCRIPT" "dependabot record script"
  require_file "$ESLINT_RECORD_SCRIPT" "eslint record script"

  local resolved_run_label
  resolved_run_label="$(resolve_run_label)"
  assert_output_pair_available "$resolved_run_label"
  log "using run label: ${resolved_run_label}"

  run_optional_token_check

  local dependabot_status=0
  set +e
  DATE_STAMP="$DATE_STAMP" \
  RUN_LABEL="$resolved_run_label" \
  OUT_DIR="$OUT_DIR" \
  LOG_DIR="$DEPENDABOT_LOG_DIR" \
  RUN_CHECK=1 \
  FAIL_ON_CHECK="$DEPENDABOT_FAIL_ON_CHECK" \
  CHECK_SCRIPT="$DEPENDABOT_CHECK_SCRIPT" \
    "$DEPENDABOT_RECORD_SCRIPT"
  dependabot_status=$?
  set -e

  local eslint_status=0
  set +e
  DATE_STAMP="$DATE_STAMP" \
  RUN_LABEL="$resolved_run_label" \
  OUT_DIR="$OUT_DIR" \
  LOG_DIR="$ESLINT_LOG_DIR" \
  RUN_CHECK=1 \
  FAIL_ON_CHECK="$ESLINT_FAIL_ON_CHECK" \
  CHECK_SCRIPT="$ESLINT_CHECK_SCRIPT" \
    "$ESLINT_RECORD_SCRIPT"
  eslint_status=$?
  set -e

  local dependabot_output="$OUT_DIR/${DATE_STAMP}-dependabot-alerts-${resolved_run_label}.md"
  local eslint_output="$OUT_DIR/${DATE_STAMP}-eslint10-readiness-${resolved_run_label}.md"
  if [[ "$dependabot_status" == "0" && "$eslint_status" == "0" ]]; then
    require_file "$dependabot_output" "generated dependabot record"
    require_file "$eslint_output" "generated eslint record"

    log "paired dependabot record: $dependabot_output"
    log "paired eslint record: $eslint_output"
  else
    if [[ "$dependabot_status" != "0" && ! -f "$dependabot_output" ]]; then
      log "dependabot recorder exited with status $dependabot_status and did not produce expected output: $dependabot_output"
    fi
    if [[ "$eslint_status" != "0" && ! -f "$eslint_output" ]]; then
      log "eslint recorder exited with status $eslint_status and did not produce expected output: $eslint_output"
    fi
  fi

  if [[ "$dependabot_status" != "0" ]]; then
    return "$dependabot_status"
  fi
  if [[ "$eslint_status" != "0" ]]; then
    return "$eslint_status"
  fi
}

main "$@"
