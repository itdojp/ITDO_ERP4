#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="${LOG_FILE:-}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/tmp/eslint10-readiness}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
RUN_CHECK="${RUN_CHECK:-0}"
FAIL_ON_CHECK="${FAIL_ON_CHECK:-0}"
CHECK_SCRIPT="${CHECK_SCRIPT:-$ROOT_DIR/scripts/check-eslint10-readiness.sh}"
check_status=""

usage() {
  cat <<USAGE
Usage:
  LOG_FILE=tmp/eslint10-readiness/eslint10-readiness-YYYYMMDD-HHMMSS.log \
    ./scripts/record-eslint10-readiness.sh

Optional env:
  LOG_FILE=...       # default: latest tmp/eslint10-readiness/*.log
  LOG_DIR=...        # default: tmp/eslint10-readiness
  OUT_DIR=...        # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD   # valid calendar date
  RUN_LABEL=r1|r2...      # [A-Za-z0-9][A-Za-z0-9._-]*
  RUN_CHECK=1        # run check-eslint10-readiness.sh and capture log
  FAIL_ON_CHECK=1    # when RUN_CHECK=1, return non-zero if readiness check failed
  CHECK_SCRIPT=...   # default: scripts/check-eslint10-readiness.sh
USAGE
}

log() {
  echo "[record-eslint10-readiness] $*"
}

die() {
  echo "[record-eslint10-readiness][ERROR] $*" >&2
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
  latest="$(ls -1t "$LOG_DIR"/eslint10-readiness-*.log 2>/dev/null | head -n 1 || true)"
  if [[ -z "$latest" ]]; then
    die "no log file found under: $LOG_DIR"
  fi
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file
  if [[ -n "$RUN_LABEL" ]]; then
    output_file="$OUT_DIR/${DATE_STAMP}-eslint10-readiness-${RUN_LABEL}.md"
    if [[ -e "$output_file" ]]; then
      die "output file already exists: $output_file"
    fi
    printf '%s\n' "$output_file"
    return
  fi

  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-eslint10-readiness-r${n}.md"
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
    LOG_FILE="$LOG_DIR/eslint10-readiness-${timestamp}.log"
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
  local source_log
  source_log="$(format_source_path "$log_file")"

  local ready check_exit summary_status executed_at branch_name commit_sha
  local plugin_target plugin_version plugin_peer plugin_supports
  local parser_target parser_version parser_peer parser_supports
  local react_plugin_target react_plugin_version react_plugin_peer react_plugin_supports
  local react_hooks_target react_hooks_version react_hooks_peer react_hooks_supports

  ready="$(extract_scalar "$log_file" 'ready')"
  plugin_target="$(extract_scalar "$log_file" 'pluginTarget')"
  plugin_version="$(extract_scalar "$log_file" 'pluginVersion')"
  plugin_peer="$(extract_scalar "$log_file" 'pluginPeerEslint')"
  plugin_supports="$(extract_scalar "$log_file" 'pluginSupportsEslint10')"
  parser_target="$(extract_scalar "$log_file" 'parserTarget')"
  parser_version="$(extract_scalar "$log_file" 'parserVersion')"
  parser_peer="$(extract_scalar "$log_file" 'parserPeerEslint')"
  parser_supports="$(extract_scalar "$log_file" 'parserSupportsEslint10')"
  react_plugin_target="$(extract_scalar "$log_file" 'reactPluginTarget')"
  react_plugin_version="$(extract_scalar "$log_file" 'reactPluginVersion')"
  react_plugin_peer="$(extract_scalar "$log_file" 'reactPluginPeerEslint')"
  react_plugin_supports="$(extract_scalar "$log_file" 'reactPluginSupportsEslint10')"
  react_hooks_target="$(extract_scalar "$log_file" 'reactHooksPluginTarget')"
  react_hooks_version="$(extract_scalar "$log_file" 'reactHooksPluginVersion')"
  react_hooks_peer="$(extract_scalar "$log_file" 'reactHooksPluginPeerEslint')"
  react_hooks_supports="$(extract_scalar "$log_file" 'reactHooksPluginSupportsEslint10')"

  if [[ -n "$check_status" ]]; then
    check_exit="$check_status"
  else
    check_exit="n/a"
  fi

  summary_status="fail"
  if [[ "$ready" == "true" ]]; then
    summary_status="pass"
  fi
  executed_at="$(date -u +%FT%TZ)"
  branch_name="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  commit_sha="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  mkdir -p "$(dirname "$output_file")"
  cat > "$output_file" <<EOF2
# ESLint10 readiness 記録

- executedAt: ${executed_at}
- branch: \`${branch_name}\`
- commit: \`${commit_sha}\`
- sourceLog: \`${source_log}\`
- summaryStatus: ${summary_status}
- ready: ${ready:-unknown}
- checkExitCode: ${check_exit}

## 収集結果
- pluginTarget: \`${plugin_target:-}\`
- pluginVersion: \`${plugin_version:-}\`
- pluginPeerEslint: \`${plugin_peer:-}\`
- pluginSupportsEslint10: ${plugin_supports:-unknown}
- parserTarget: \`${parser_target:-}\`
- parserVersion: \`${parser_version:-}\`
- parserPeerEslint: \`${parser_peer:-}\`
- parserSupportsEslint10: ${parser_supports:-unknown}
- reactPluginTarget: \`${react_plugin_target:-}\`
- reactPluginVersion: \`${react_plugin_version:-}\`
- reactPluginPeerEslint: \`${react_plugin_peer:-}\`
- reactPluginSupportsEslint10: ${react_plugin_supports:-unknown}
- reactHooksPluginTarget: \`${react_hooks_target:-}\`
- reactHooksPluginVersion: \`${react_hooks_version:-}\`
- reactHooksPluginPeerEslint: \`${react_hooks_peer:-}\`
- reactHooksPluginSupportsEslint10: ${react_hooks_supports:-unknown}

## ログ
EOF2
  printf '%s\n' '```text' >>"$output_file"
  cat "$log_file" >>"$output_file"
  printf '%s\n' '```' >>"$output_file"
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
