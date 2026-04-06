#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
TEMPLATE_PATH="$ROOT_DIR/docs/test-results/sakura-vps-trial-template.md"
EVIDENCE_DIR="${EVIDENCE_DIR:-}"
DATE_STAMP="${DATE_STAMP:-$(date +%F)}"
RUN_LABEL="${RUN_LABEL:-}"
OPERATOR_NAME="${OPERATOR_NAME:-}"
TARGET_HOST="${TARGET_HOST:-}"
VPS_IP="${VPS_IP:-}"

usage() {
  cat <<USAGE
Usage:
  ./scripts/record-sakura-vps-trial.sh

Optional env:
  EVIDENCE_DIR=...    # default: latest tmp/sakura-vps-trial-*
  OUT_DIR=...         # default: docs/test-results
  DATE_STAMP=YYYY-MM-DD
  RUN_LABEL=r1|r2...  # [A-Za-z0-9][A-Za-z0-9._-]*
  OPERATOR_NAME=...
  TARGET_HOST=...     # default: collected host from meta.txt
  VPS_IP=...

Validation:
- DATE_STAMP must be a valid calendar date (YYYY-MM-DD)
- RUN_LABEL must match ^[A-Za-z0-9][A-Za-z0-9._-]*$
- existing output file is never overwritten
USAGE
}

die() {
  echo "[record-sakura-vps-trial][ERROR] $*" >&2
  exit 1
}

log() {
  echo "[record-sakura-vps-trial] $*"
}

resolve_absolute_path() {
  local input="$1"
  if [[ "$input" = /* ]]; then
    printf '%s\n' "$input"
  else
    printf '%s\n' "$ROOT_DIR/$input"
  fi
}

normalize_report_path() {
  local input="${1:-}"
  if [[ -z "$input" ]]; then
    printf '%s\n' ""
    return
  fi
  local resolved="$input"
  if [[ "$resolved" != /* ]]; then
    resolved="$ROOT_DIR/$resolved"
  fi
  case "$resolved" in
    "$ROOT_DIR"/*)
      printf '%s\n' "${resolved#$ROOT_DIR/}"
      ;;
    *)
      printf '%s\n' "$input"
      ;;
  esac
}

validate_date_stamp() {
  [[ "$DATE_STAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "DATE_STAMP must be YYYY-MM-DD"

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

find_latest_evidence_dir() {
  local latest
  latest="$(ls -1dt "$ROOT_DIR"/tmp/sakura-vps-trial-* 2>/dev/null | head -n 1 || true)"
  [[ -n "$latest" ]] || die 'no trial evidence directory found under tmp/'
  printf '%s\n' "$latest"
}

resolve_output_file() {
  local output_file
  if [[ -n "$RUN_LABEL" ]]; then
    output_file="$OUT_DIR/${DATE_STAMP}-sakura-vps-trial-${RUN_LABEL}.md"
    [[ ! -e "$output_file" ]] || die "output file already exists: $output_file"
    printf '%s\n' "$output_file"
    return
  fi

  local n=1
  while true; do
    output_file="$OUT_DIR/${DATE_STAMP}-sakura-vps-trial-r${n}.md"
    if [[ ! -e "$output_file" ]]; then
      printf '%s\n' "$output_file"
      return
    fi
    n=$((n + 1))
  done
}

read_meta_value() {
  local key="$1"
  local file="$2"
  python3 - "$key" "$file" <<'PY'
import pathlib, sys
key = sys.argv[1]
path = pathlib.Path(sys.argv[2])
for line in reversed(path.read_text(encoding='utf-8', errors='replace').splitlines()):
    if line.startswith(key + '='):
        print(line.split('=', 1)[1])
        break
PY
}

format_exit_summary() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    printf '%s\n' "- ${name}: \`-\`"
    return
  fi
  if [[ "$value" == "0" ]]; then
    printf '%s\n' "- ${name}: \`success\`"
  else
    printf '%s\n' "- ${name}: \`failed (exit ${value})\`"
  fi
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      exit 0
      ;;
  esac

  validate_date_stamp
  validate_run_label
  [[ -f "$TEMPLATE_PATH" ]] || die "template not found: $TEMPLATE_PATH"

  OUT_DIR="$(resolve_absolute_path "$OUT_DIR")"
  mkdir -p "$OUT_DIR"

  if [[ -z "$EVIDENCE_DIR" ]]; then
    EVIDENCE_DIR="$(find_latest_evidence_dir)"
  else
    EVIDENCE_DIR="$(resolve_absolute_path "$EVIDENCE_DIR")"
  fi
  [[ -d "$EVIDENCE_DIR" ]] || die "evidence directory not found: $EVIDENCE_DIR"

  local meta_file status_file logs_file timers_file https_file
  meta_file="$EVIDENCE_DIR/meta.txt"
  status_file="$EVIDENCE_DIR/status-stack.txt"
  logs_file="$EVIDENCE_DIR/logs-stack.txt"
  timers_file="$EVIDENCE_DIR/list-timers.txt"
  https_file="$EVIDENCE_DIR/check-https.txt"

  [[ -f "$meta_file" ]] || die "meta file not found: $meta_file"
  [[ -f "$status_file" ]] || die "status evidence not found: $status_file"
  [[ -f "$logs_file" ]] || die "logs evidence not found: $logs_file"
  [[ -f "$timers_file" ]] || die "timer evidence not found: $timers_file"

  local evidence_host git_commit include_proxy lines collected_at
  local status_exit logs_exit timers_exit https_exit branch_name commit_short output_file
  evidence_host="$(read_meta_value host "$meta_file")"
  git_commit="$(read_meta_value git_commit "$meta_file")"
  include_proxy="$(read_meta_value include_proxy "$meta_file")"
  lines="$(read_meta_value lines "$meta_file")"
  collected_at="$(read_meta_value collected_at "$meta_file")"
  status_exit="$(read_meta_value status_stack_exit "$meta_file")"
  logs_exit="$(read_meta_value logs_stack_exit "$meta_file")"
  timers_exit="$(read_meta_value list_timers_exit "$meta_file")"
  https_exit="$(read_meta_value check_https_exit "$meta_file")"

  if [[ -z "$TARGET_HOST" ]]; then
    TARGET_HOST="$evidence_host"
  fi
  if [[ -z "$TARGET_HOST" ]]; then
    TARGET_HOST="-"
  fi

  branch_name="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')"
  if [[ -n "$git_commit" && "$git_commit" != "unknown" ]]; then
    commit_short="${git_commit:0:8}"
  else
    commit_short="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
  fi

  output_file="$(resolve_output_file)"

  python3 - "$TEMPLATE_PATH" "$output_file" "$DATE_STAMP" "$OPERATOR_NAME" "$TARGET_HOST" "$VPS_IP" "$branch_name" "$commit_short" <<'PY'
import pathlib, sys
src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
out = pathlib.Path(sys.argv[2])
replacements = {
    '- 実施日: YYYY-MM-DD': f'- 実施日: {sys.argv[3]}',
    '- 実施者:': f'- 実施者: {sys.argv[4] or "-"}',
    '- 対象ホスト名:': f'- 対象ホスト名: {sys.argv[5] or "-"}',
    '- VPS IP:': f'- VPS IP: {sys.argv[6] or "-"}',
    '- 対象ブランチ / commit SHA:': f'- 対象ブランチ / commit SHA: `{sys.argv[7]} / {sys.argv[8]}`',
}
for old, new in replacements.items():
    src = src.replace(old, new)
try:
    with out.open('x', encoding='utf-8') as fh:
        fh.write(src)
except FileExistsError:
    raise SystemExit(f'output file already exists: {out}')
PY

  {
    printf '\n## 7. 自動採取サマリ\n'
    printf -- '- sourceEvidenceDir: `%s`\n' "$(normalize_report_path "$EVIDENCE_DIR")"
    printf -- '- collectedAt: `%s`\n' "${collected_at:-unknown}"
    printf -- '- includeProxy: `%s`\n' "${include_proxy:-0}"
    printf -- '- lines: `%s`\n' "${lines:-100}"
    format_exit_summary 'status-stack.sh' "$status_exit"
    format_exit_summary 'logs-stack.sh' "$logs_exit"
    format_exit_summary "systemctl --user list-timers 'erp4-*'" "$timers_exit"
    if [[ -f "$https_file" || -n "$https_exit" || "$include_proxy" == "1" ]]; then
      format_exit_summary 'check-https.sh' "$https_exit"
    fi
    printf '\n## 8. 自動採取ファイル\n'
    printf -- '- `%s`\n' "$(normalize_report_path "$meta_file")"
    printf -- '- `%s`\n' "$(normalize_report_path "$status_file")"
    printf -- '- `%s`\n' "$(normalize_report_path "$logs_file")"
    printf -- '- `%s`\n' "$(normalize_report_path "$timers_file")"
    if [[ -f "$https_file" ]]; then
      printf -- '- `%s`\n' "$(normalize_report_path "$https_file")"
    fi
  } >>"$output_file"

  log "wrote: $output_file"
}

main "$@"
