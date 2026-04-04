#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
TEMPLATE_PATH="$ROOT_DIR/docs/test-results/dr-restore-template.md"
LOG_FILE="${LOG_FILE:-}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
ENV_NAME="${ENV_NAME:-PoC}"
OPERATOR_NAME="${OPERATOR_NAME:-}"
TARGET_NAME="${TARGET_NAME:-DB}"

usage() {
  cat <<USAGE
Usage:
  LOG_FILE=tmp/erp4-dr-verify-YYYYMMDD-HHMMSS.log ./scripts/record-dr-restore.sh

Optional env:
  LOG_FILE=...          # default: latest tmp/erp4-dr-verify-*.log
  OUT_DIR=...           # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...
  ENV_NAME=PoC|検証|本番相当
  OPERATOR_NAME=...
  TARGET_NAME=DB|添付|設定

Validation:
- DATE_STAMP must be a valid calendar date (YYYY-MM-DD)
- RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$
- existing output file is never overwritten
USAGE
}

die() {
  echo "[record-dr-restore][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[record-dr-restore] $*"
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
  local parsed=""
  if parsed="$(date -d "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  elif parsed="$(date -j -f '%Y-%m-%d' "$DATE_STAMP" +%F 2>/dev/null)"; then
    :
  fi
  [[ "$parsed" == "$DATE_STAMP" ]] || die "DATE_STAMP is not a valid calendar date: $DATE_STAMP"
}

validate_run_label() {
  if [[ -z "$RUN_LABEL" ]]; then
    return 0
  fi
  [[ "$RUN_LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$"
}

find_latest_log_file() {
  local latest
  latest="$(ls -1t "$ROOT_DIR"/tmp/erp4-dr-verify-*.log 2>/dev/null | head -n 1 || true)"
  [[ -n "$latest" ]] || die 'no restore verification log found under tmp/'
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file
  if [[ -n "$RUN_LABEL" ]]; then
    output_file="$OUT_DIR/${DATE_STAMP}-dr-restore-${RUN_LABEL}.md"
    [[ ! -e "$output_file" ]] || die "output file already exists: $output_file"
    printf '%s\n' "$output_file"
    return
  fi
  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-dr-restore-r${n}.md"
    if [[ ! -e "$output_file" ]]; then
      printf '%s\n' "$output_file"
      return
    fi
    n=$((n + 1))
  done
}

extract_first_match() {
  local pattern="$1"
  local file="$2"
  python3 - "$pattern" "$file" <<'PY'
import pathlib, re, sys
pattern = re.compile(sys.argv[1])
text = pathlib.Path(sys.argv[2]).read_text(errors='replace').splitlines()
for line in text:
    m = pattern.search(line)
    if m:
        print(m.group(1))
        break
PY
}

main() {
  validate_date_stamp
  validate_run_label
  [[ -f "$TEMPLATE_PATH" ]] || die "template not found: $TEMPLATE_PATH"
  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  mkdir -p "$OUT_DIR"

  if [[ -z "$LOG_FILE" ]]; then
    LOG_FILE="$(find_latest_log_file)"
  else
    LOG_FILE="$(resolve_absolute_path "$LOG_FILE")"
  fi
  [[ -f "$LOG_FILE" ]] || die "log file not found: $LOG_FILE"

  local started completed duration backup_db backup_globals output_file git_branch git_ref success_label
  started="$(extract_first_match '^\[restore-verify\] started: (.+)$' "$LOG_FILE")"
  completed="$(extract_first_match '^\[restore-verify\] completed: (.+)$' "$LOG_FILE")"
  duration="$(extract_first_match '^\[restore-verify\] success \(duration: ([0-9]+s)\)$' "$LOG_FILE")"
  backup_db="$(extract_first_match '^backup created: (.+)$' "$LOG_FILE")"
  backup_globals="$(extract_first_match '^globals created: (.+)$' "$LOG_FILE")"

  if grep -q '^\[restore-verify\] success ' "$LOG_FILE"; then
    success_label='成功'
  else
    success_label='失敗'
  fi

  output_file="$(resolve_output_file)"
  git_branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  git_ref="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

  python3 - "$TEMPLATE_PATH" "$output_file" <<'PY'
import pathlib, sys
src = pathlib.Path(sys.argv[1]).read_text()
out = pathlib.Path(sys.argv[2])
replacements = {
    '- 実施日: YYYY-MM-DD': '- 実施日: `__DATE__`',
    '- 環境: PoC / 検証 / 本番相当': '- 環境: `__ENV__`',
    '- 実施者:': '- 実施者: `__OPERATOR__`',
    '- 対象: DB / 添付 / 設定（該当するもの）': '- 対象: `__TARGET__`',
    '  - DB:': '  - DB: `__DB__`',
    '  - globals:': '  - globals: `__GLOBALS__`',
    '- 手順/コマンド:': '- 手順/コマンド: `scripts/restore-verify.sh`',
    '  - ファイル: （例: `tmp/erp4-dr-verify-YYYYMMDD-HHMMSS.log`）': '  - ファイル: `__LOG__`',
    '  - リストア開始〜完了:': '  - リストア開始〜完了: `__DURATION__`',
    '- 成功/失敗:': '- 成功/失敗: `__SUCCESS__`',
}
for old, new in replacements.items():
    src = src.replace(old, new)
out.write_text(src)
PY

  python3 - "$output_file" "$DATE_STAMP" "$ENV_NAME" "$OPERATOR_NAME" "$TARGET_NAME" "$backup_db" "$backup_globals" "$LOG_FILE" "$duration" "$success_label" "$started" "$completed" "$git_branch" "$git_ref" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text()
vals = {
    '__DATE__': sys.argv[2],
    '__ENV__': sys.argv[3] or '-',
    '__OPERATOR__': sys.argv[4] or '-',
    '__TARGET__': sys.argv[5] or 'DB',
    '__DB__': sys.argv[6] or '-',
    '__GLOBALS__': sys.argv[7] or '-',
    '__LOG__': sys.argv[8],
    '__DURATION__': sys.argv[9] or '-',
    '__SUCCESS__': sys.argv[10],
}
for k, v in vals.items():
    text = text.replace(k, v)
from datetime import UTC, datetime
text += f"\n## メタデータ\n- generatedAt: `{datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')}`\n- sourceLogStartedAt: `{sys.argv[11] or '-'}`\n- sourceLogCompletedAt: `{sys.argv[12] or '-'}`\n- branch: `{sys.argv[13]}`\n- commit: `{sys.argv[14]}`\n"
p.write_text(text)
PY

  log "wrote: $output_file"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

main "$@"
