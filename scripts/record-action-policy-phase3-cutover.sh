#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
READINESS_RECORD_FILE="${READINESS_RECORD_FILE:-}"
FROM_PRESET="${FROM_PRESET:-phase2_core}"
TO_PRESET="${TO_PRESET:-phase3_strict}"

usage() {
  cat <<USAGE
Usage:
  READINESS_RECORD_FILE=docs/test-results/YYYY-MM-DD-action-policy-phase3-readiness-rN.md \
    ./scripts/record-action-policy-phase3-cutover.sh

Optional env:
  READINESS_RECORD_FILE=...   # default: latest docs/test-results/*-action-policy-phase3-readiness-*.md
  OUT_DIR=...                 # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...
  FROM_PRESET=phase2_core
  TO_PRESET=phase3_strict

Validation:
- DATE_STAMP must be a valid calendar date (YYYY-MM-DD)
- RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$
- existing output file is never overwritten
USAGE
}

die() {
  echo "[record-action-policy-phase3-cutover][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[record-action-policy-phase3-cutover] $*"
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

find_latest_readiness_record() {
  local latest
  latest="$(
    ls -1t "$ROOT_DIR"/docs/test-results/*-action-policy-phase3-readiness-*.md 2>/dev/null \
      | head -n 1 || true
  )"
  if [[ -z "$latest" ]]; then
    die "no action policy phase3 readiness record found under docs/test-results/"
  fi
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-cutover-${RUN_LABEL}.md"
  if [[ -n "$RUN_LABEL" ]]; then
    if [[ -e "$output_file" ]]; then
      die "output file already exists: $output_file"
    fi
    printf '%s\n' "$output_file"
    return
  fi
  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-action-policy-phase3-cutover-r${n}.md"
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
    grep -E "^- ${key}:" "$file_path" | tail -n 1 | sed "s|^- ${key}:[[:space:]]*||"
  )"
  if [[ -z "$value" ]]; then
    printf 'unknown\n'
  else
    printf '%s\n' "$value"
  fi
}

main() {
  validate_date_stamp
  validate_run_label

  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  mkdir -p "$OUT_DIR"

  if [[ -z "$READINESS_RECORD_FILE" ]]; then
    READINESS_RECORD_FILE="$(find_latest_readiness_record)"
  else
    READINESS_RECORD_FILE="$(resolve_absolute_path "$READINESS_RECORD_FILE")"
  fi
  require_file "$READINESS_RECORD_FILE" "readiness record file"

  local output_file
  output_file="$(resolve_output_file)"

  local ready from_to missing stale dynamic fallback_total fallback_high fallback_medium fallback_unknown
  ready="$(extract_scalar "$READINESS_RECORD_FILE" "ready")"
  from_to="$(extract_scalar "$READINESS_RECORD_FILE" "from/to")"
  missing="$(extract_scalar "$READINESS_RECORD_FILE" "missing_static_callsites")"
  stale="$(extract_scalar "$READINESS_RECORD_FILE" "stale_required_actions")"
  dynamic="$(extract_scalar "$READINESS_RECORD_FILE" "dynamic_callsites")"
  fallback_total="$(extract_scalar "$READINESS_RECORD_FILE" "fallback_unique_keys")"
  fallback_high="$(extract_scalar "$READINESS_RECORD_FILE" "fallback_high_risk_keys")"
  fallback_medium="$(extract_scalar "$READINESS_RECORD_FILE" "fallback_medium_risk_keys")"
  fallback_unknown="$(extract_scalar "$READINESS_RECORD_FILE" "fallback_unknown_risk_keys")"

  if ! (
    set -o noclobber
    {
      echo "# ActionPolicy phase3 cutover 記録"
      echo
      echo "- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "- sourceReadinessRecord: \`$READINESS_RECORD_FILE\`"
      echo "- branch: $(git -C "$ROOT_DIR" branch --show-current)"
      echo "- commit: $(git -C "$ROOT_DIR" rev-parse --short HEAD)"
      echo "- fromPreset: \`$FROM_PRESET\`"
      echo "- toPreset: \`$TO_PRESET\`"
      echo
      echo "## 事前 readiness"
      echo
      echo "- ready: ${ready}"
      echo "- from/to: ${from_to}"
      echo "- missing_static_callsites: ${missing}"
      echo "- stale_required_actions: ${stale}"
      echo "- dynamic_callsites: ${dynamic}"
      echo "- fallback_unique_keys: ${fallback_total}"
      echo "- fallback_high_risk_keys: ${fallback_high}"
      echo "- fallback_medium_risk_keys: ${fallback_medium}"
      echo "- fallback_unknown_risk_keys: ${fallback_unknown}"
      echo
      echo "## 切替手順"
      echo
      echo '```bash'
      echo 'make action-policy-phase3-readiness-record'
      echo '# 環境変数または設定を phase3_strict に変更'
      echo 'make action-policy-fallback-report'
      echo 'make action-policy-fallback-report-json'
      echo '```'
      echo
      echo "- [ ] \`$TO_PRESET\` へ切替した"
      echo "- [ ] アプリ再起動 / 再デプロイを実施した"
      echo
      echo "## 主要操作確認"
      echo
      echo "- [ ] \`invoice:send\`"
      echo "- [ ] \`invoice:mark_paid\`"
      echo "- [ ] \`purchase_order:send\`"
      echo "- [ ] \`expense:submit\`"
      echo "- [ ] \`expense:mark_paid\`"
      echo "- [ ] \`vendor_invoice:submit\`"
      echo "- [ ] \`vendor_invoice:update_lines\`"
      echo "- [ ] \`vendor_invoice:update_allocations\`"
      echo "- [ ] \`*:approve\`"
      echo "- [ ] \`*:reject\`"
      echo
      echo "## 切替後 fallback 確認"
      echo
      echo "- [ ] \`make action-policy-fallback-report-json\` で新規 fallback key が 0 件"
      echo "- [ ] 影響があれば \`flowType:actionKey:targetTable\` を記録した"
      echo
      echo '```text'
      echo '(none)'
      echo '```'
      echo
      echo "## ロールバック"
      echo
      echo "- [ ] ロールバック不要"
      echo "- [ ] \`$FROM_PRESET\` へロールバックした"
      echo "- [ ] \`ACTION_POLICY_REQUIRED_ACTIONS\` 明示指定で段階復旧した"
      echo
      echo "## 所見"
      echo
      echo "-"
    } > "$output_file"
  ); then
    die "failed to write output file without overwrite: $output_file"
  fi

  log "wrote: $output_file"
}

main "$@"
