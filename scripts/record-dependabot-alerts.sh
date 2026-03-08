#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${LOG_FILE:-}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/tmp/dependabot-alerts}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
RUN_CHECK="${RUN_CHECK:-0}"
FAIL_ON_CHECK="${FAIL_ON_CHECK:-0}"
CHECK_SCRIPT="${CHECK_SCRIPT:-$ROOT_DIR/scripts/check-dependabot-alerts.sh}"
check_status=""

usage() {
  cat <<USAGE
Usage:
  LOG_FILE=tmp/dependabot-alerts/dependabot-alerts-YYYYMMDD-HHMMSS.log \
    ./scripts/record-dependabot-alerts.sh

Optional env:
  LOG_FILE=...       # default: latest tmp/dependabot-alerts/*.log
  LOG_DIR=...        # default: tmp/dependabot-alerts
  OUT_DIR=...        # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD   # valid calendar date
  RUN_LABEL=r1|r2...      # [A-Za-z0-9][A-Za-z0-9._-]*
  RUN_CHECK=1        # run check-dependabot-alerts.sh and capture log
  FAIL_ON_CHECK=1    # when RUN_CHECK=1, return non-zero if the check failed
  CHECK_SCRIPT=...   # default: scripts/check-dependabot-alerts.sh
USAGE
}

log() {
  echo "[record-dependabot-alerts] $*"
}

die() {
  echo "[record-dependabot-alerts][ERROR] $*" >&2
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

validate_binary_flag() {
  local name="$1"
  local value="${!name}"
  case "$value" in
    0|1) ;;
    *) die "${name} must be 0|1 (got: ${value})" ;;
  esac
}

validate_date_stamp() {
  if [[ ! "$DATE_STAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    die "DATE_STAMP must be YYYY-MM-DD (got: ${DATE_STAMP})"
  fi

  local normalized=""
  if normalized="$(date -u -d "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  elif normalized="$(date -j -u -f '%Y-%m-%d' "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
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
  latest="$(ls -1t "$LOG_DIR"/dependabot-alerts-*.log 2>/dev/null | head -n 1 || true)"
  if [[ -z "$latest" ]]; then
    die "no log file found under: $LOG_DIR"
  fi
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file
  if [[ -n "$RUN_LABEL" ]]; then
    output_file="$OUT_DIR/${DATE_STAMP}-dependabot-alerts-${RUN_LABEL}.md"
    if [[ -e "$output_file" ]]; then
      die "output file already exists: $output_file"
    fi
    printf '%s\n' "$output_file"
    return
  fi

  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-dependabot-alerts-r${n}.md"
    if [[ ! -e "$output_file" ]]; then
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
    LOG_FILE="$LOG_DIR/dependabot-alerts-${timestamp}.log"
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

extract_scalar() {
  local log_file="$1"
  local key="$2"
  grep -E "^${key}:" "$log_file" | tail -n 1 | sed "s|^${key}:[[:space:]]*||" || true
}

write_report() {
  local log_file="$1"
  local output_file="$2"

  local action_required summary_status check_exit executed_at branch_name commit_sha
  action_required="$(extract_scalar "$log_file" 'actionRequired')"
  local alert_low_state alert_high_state alert_low_ghsa alert_high_ghsa
  local googleapis_current googleapis_latest googleapis_common_current googleapis_common_latest
  local qs_version qs_patched fast_xml_version fast_xml_patched upstream_updated

  alert_low_state="$(extract_scalar "$log_file" 'alertLowState')"
  alert_high_state="$(extract_scalar "$log_file" 'alertHighState')"
  alert_low_ghsa="$(extract_scalar "$log_file" 'alertLowGhsa')"
  alert_high_ghsa="$(extract_scalar "$log_file" 'alertHighGhsa')"
  googleapis_current="$(extract_scalar "$log_file" 'googleapisCurrent')"
  googleapis_latest="$(extract_scalar "$log_file" 'googleapisLatest')"
  googleapis_common_current="$(extract_scalar "$log_file" 'googleapisCommonCurrent')"
  googleapis_common_latest="$(extract_scalar "$log_file" 'googleapisCommonLatest')"
  qs_version="$(extract_scalar "$log_file" 'qsResolvedVersion')"
  qs_patched="$(extract_scalar "$log_file" 'qsPatched')"
  fast_xml_version="$(extract_scalar "$log_file" 'fastXmlResolvedVersion')"
  fast_xml_patched="$(extract_scalar "$log_file" 'fastXmlPatched')"
  upstream_updated="$(extract_scalar "$log_file" 'upstreamUpdated')"

  if [[ -n "$check_status" ]]; then
    check_exit="$check_status"
  else
    check_exit="n/a"
  fi

  summary_status="pass"
  if [[ "$action_required" == "true" ]]; then
    summary_status="fail"
  fi
  executed_at="$(date -u +%FT%TZ)"
  branch_name="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  commit_sha="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  mkdir -p "$(dirname "$output_file")"
  cat > "$output_file" <<EOF2
# Dependabot alerts 監視記録

- executedAt: ${executed_at}
- branch: \`${branch_name}\`
- commit: \`${commit_sha}\`
- sourceLog: \`${log_file}\`
- summaryStatus: ${summary_status}
- actionRequired: ${action_required:-unknown}
- checkExitCode: ${check_exit}

## Alert 状態
- alertLowState: ${alert_low_state:-unknown}
- alertLowGhsa: \`${alert_low_ghsa:-}\`
- alertHighState: ${alert_high_state:-unknown}
- alertHighGhsa: \`${alert_high_ghsa:-}\`

## 依存解決状態
- googleapisCurrent: \`${googleapis_current:-}\`
- googleapisLatest: \`${googleapis_latest:-}\`
- googleapisCommonCurrent: \`${googleapis_common_current:-}\`
- googleapisCommonLatest: \`${googleapis_common_latest:-}\`
- qsResolvedVersion: \`${qs_version:-}\`
- qsPatched: ${qs_patched:-unknown}
- fastXmlResolvedVersion: \`${fast_xml_version:-}\`
- fastXmlPatched: ${fast_xml_patched:-unknown}
- upstreamUpdated: ${upstream_updated:-unknown}

## ログ
\```text
$(cat "$log_file")
\```
EOF2
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  validate_binary_flag RUN_CHECK
  validate_binary_flag FAIL_ON_CHECK
  validate_date_stamp
  validate_run_label

  if [[ "$RUN_CHECK" == "1" ]]; then
    run_check_and_capture
  else
    if [[ -n "$LOG_FILE" ]]; then
      LOG_FILE="$(resolve_absolute_path "$LOG_FILE")"
    else
      LOG_FILE="$(find_latest_log_file)"
    fi
  fi

  if [[ ! -f "$LOG_FILE" ]]; then
    die "log file not found: $LOG_FILE"
  fi

  local output_file
  output_file="$(resolve_output_file)"
  write_report "$LOG_FILE" "$output_file"
  log "wrote report: $output_file"

  if [[ "$RUN_CHECK" == "1" && "$FAIL_ON_CHECK" == "1" && -n "$check_status" && "$check_status" != "0" ]]; then
    return "$check_status"
  fi
}

main "$@"
