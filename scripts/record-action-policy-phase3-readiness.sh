#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
READINESS_TEXT_FILE="${READINESS_TEXT_FILE:-}"
READINESS_JSON_FILE="${READINESS_JSON_FILE:-}"
FALLBACK_TEXT_FILE="${FALLBACK_TEXT_FILE:-}"
FALLBACK_JSON_FILE="${FALLBACK_JSON_FILE:-}"

usage() {
  cat <<USAGE
Usage:
  LOG_DIR=tmp/action-policy-phase3-readiness/run-YYYYMMDD-HHMMSS \
    ./scripts/record-action-policy-phase3-readiness.sh

Optional env:
  LOG_DIR=...              # default: latest tmp/action-policy-phase3-readiness/run-*
  OUT_DIR=...              # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...
  READINESS_TEXT_FILE=...  # default: <LOG_DIR>/phase3-readiness.txt
  READINESS_JSON_FILE=...  # default: <LOG_DIR>/phase3-readiness.json
  FALLBACK_TEXT_FILE=...   # default: <LOG_DIR>/fallback-report.txt
  FALLBACK_JSON_FILE=...   # default: <LOG_DIR>/fallback-report.json

Validation:
- DATE_STAMP must be a valid calendar date (YYYY-MM-DD)
- RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$
- existing output file is never overwritten
USAGE
}

die() {
  echo "[record-action-policy-phase3-readiness][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[record-action-policy-phase3-readiness] $*"
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
  latest="$(
    ls -1dt "$ROOT_DIR"/tmp/action-policy-phase3-readiness/run-* 2>/dev/null \
      | head -n 1 || true
  )"
  if [[ -z "$latest" ]]; then
    die "no action policy phase3 readiness log directory found under tmp/action-policy-phase3-readiness/"
  fi
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-readiness-${RUN_LABEL}.md"
  if [[ -n "$RUN_LABEL" ]]; then
    if [[ -e "$output_file" ]]; then
      die "output file already exists: $output_file"
    fi
    printf '%s\n' "$output_file"
    return
  fi
  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-readiness-r${n}.md"
    if [[ ! -f "$output_file" ]]; then
      printf '%s\n' "$output_file"
      return
    fi
    n=$((n + 1))
  done
}

require_file() {
  local file_path="$1"
  local label="$2"
  if [[ ! -f "$file_path" ]]; then
    die "${label} not found: $file_path"
  fi
}

extract_scalar() {
  local file_path="$1"
  local key="$2"
  local value
  value="$(
    grep -E "^${key}:" "$file_path" | tail -n 1 | sed "s/^${key}:[[:space:]]*//"
  )"
  if [[ -z "$value" ]]; then
    printf 'unknown\n'
  else
    printf '%s\n' "$value"
  fi
}

extract_section() {
  local file_path="$1"
  local header="$2"
  awk -v header="$header" '
    $0 == header { in_section=1; next }
    /^## / && in_section { exit }
    in_section { print }
  ' "$file_path"
}

main() {
  validate_date_stamp
  validate_run_label

  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  mkdir -p "$OUT_DIR"

  if [[ -z "$LOG_DIR" ]]; then
    LOG_DIR="$(find_latest_log_dir)"
  else
    LOG_DIR="$(resolve_absolute_path "$LOG_DIR")"
  fi
  if [[ ! -d "$LOG_DIR" ]]; then
    die "log directory not found: $LOG_DIR"
  fi

  if [[ -z "$READINESS_TEXT_FILE" ]]; then
    READINESS_TEXT_FILE="$LOG_DIR/phase3-readiness.txt"
  else
    READINESS_TEXT_FILE="$(resolve_absolute_path "$READINESS_TEXT_FILE")"
  fi
  if [[ -z "$READINESS_JSON_FILE" ]]; then
    READINESS_JSON_FILE="$LOG_DIR/phase3-readiness.json"
  else
    READINESS_JSON_FILE="$(resolve_absolute_path "$READINESS_JSON_FILE")"
  fi
  if [[ -z "$FALLBACK_TEXT_FILE" ]]; then
    FALLBACK_TEXT_FILE="$LOG_DIR/fallback-report.txt"
  else
    FALLBACK_TEXT_FILE="$(resolve_absolute_path "$FALLBACK_TEXT_FILE")"
  fi
  if [[ -z "$FALLBACK_JSON_FILE" ]]; then
    FALLBACK_JSON_FILE="$LOG_DIR/fallback-report.json"
  else
    FALLBACK_JSON_FILE="$(resolve_absolute_path "$FALLBACK_JSON_FILE")"
  fi

  require_file "$READINESS_TEXT_FILE" "readiness text file"
  require_file "$READINESS_JSON_FILE" "readiness json file"
  require_file "$FALLBACK_TEXT_FILE" "fallback text file"
  require_file "$FALLBACK_JSON_FILE" "fallback json file"

  local output_file
  output_file="$(resolve_output_file)"

  local source_log_dir source_readiness_text source_readiness_json source_fallback_text source_fallback_json
  source_log_dir="$(format_source_path "$LOG_DIR")"
  source_readiness_text="$(format_source_path "$READINESS_TEXT_FILE")"
  source_readiness_json="$(format_source_path "$READINESS_JSON_FILE")"
  source_fallback_text="$(format_source_path "$FALLBACK_TEXT_FILE")"
  source_fallback_json="$(format_source_path "$FALLBACK_JSON_FILE")"

  local ready from to missing stale dynamic fallback_total fallback_high fallback_medium fallback_unknown
  ready="$(extract_scalar "$READINESS_TEXT_FILE" "ready")"
  from="$(extract_scalar "$READINESS_TEXT_FILE" "from")"
  to="$(extract_scalar "$READINESS_TEXT_FILE" "to")"
  missing="$(extract_scalar "$READINESS_TEXT_FILE" "missing_static_callsites")"
  stale="$(extract_scalar "$READINESS_TEXT_FILE" "stale_required_actions")"
  dynamic="$(extract_scalar "$READINESS_TEXT_FILE" "dynamic_callsites")"
  fallback_total="$(extract_scalar "$READINESS_TEXT_FILE" "fallback_unique_keys")"
  fallback_high="$(extract_scalar "$READINESS_TEXT_FILE" "fallback_high_risk_keys")"
  fallback_medium="$(extract_scalar "$READINESS_TEXT_FILE" "fallback_medium_risk_keys")"
  fallback_unknown="$(extract_scalar "$READINESS_TEXT_FILE" "fallback_unknown_risk_keys")"

  local blockers_section fallback_keys_section
  blockers_section="$(extract_section "$READINESS_TEXT_FILE" "## blockers")"
  fallback_keys_section="$(extract_section "$READINESS_TEXT_FILE" "## fallback keys")"

  if ! (
    set -o noclobber
    {
      echo "# ActionPolicy phase3 readiness 記録"
      echo
      echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "- sourceLogDir: \`$source_log_dir\`"
      echo "- readinessText: \`$source_readiness_text\`"
      echo "- readinessJson: \`$source_readiness_json\`"
      echo "- fallbackText: \`$source_fallback_text\`"
      echo "- fallbackJson: \`$source_fallback_json\`"
      echo "- branch: $(git -C "$ROOT_DIR" branch --show-current)"
      echo "- commit: $(git -C "$ROOT_DIR" rev-parse --short HEAD)"
      echo
      echo "## Summary"
      echo
      echo "- ready: ${ready}"
      echo "- from/to: ${from} -> ${to}"
      echo "- missing_static_callsites: ${missing}"
      echo "- stale_required_actions: ${stale}"
      echo "- dynamic_callsites: ${dynamic}"
      echo "- fallback_unique_keys: ${fallback_total}"
      echo "- fallback_high_risk_keys: ${fallback_high}"
      echo "- fallback_medium_risk_keys: ${fallback_medium}"
      echo "- fallback_unknown_risk_keys: ${fallback_unknown}"
      echo
      echo "## Blockers"
      echo
      echo '```text'
      if [[ -n "$blockers_section" ]]; then
        printf '%s\n' "$blockers_section"
      else
        printf '(none)\n'
      fi
      echo '```'
      echo
      echo "## Fallback Keys"
      echo
      echo '```text'
      if [[ -n "$fallback_keys_section" ]]; then
        printf '%s\n' "$fallback_keys_section"
      else
        printf '(none)\n'
      fi
      echo '```'
    } > "$output_file"
  ); then
    die "failed to write output file without overwrite: $output_file"
  fi

  log "wrote: $output_file"
}

main "$@"
