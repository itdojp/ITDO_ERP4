#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/docs/test-results"
TEMPLATE_PATH="${OUT_DIR}/mobile-regression-template.md"

DATE="${DATE:-$(date +%Y-%m-%d)}"
RUN="${RUN:-}"
PR_NUMBER="${PR:-}"
SCREEN_DIR="${SCREEN_DIR:-}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/new-mobile-regression-log.sh [options]

Options:
  --date YYYY-MM-DD         Set evidence date (default: today)
  --run rN|N                Set run suffix (default: first available rN)
  --pr NUMBER|#NUMBER       Set PR number for template metadata
  --screen-dir PATH         Set screenshot directory path for PR snippet
  --dry-run                 Print result without creating file
  -h, --help                Show this help
EOF
}

normalize_run() {
  local value="$1"
  if [[ -z "$value" ]]; then
    echo ""
    return 0
  fi
  if [[ "$value" =~ ^r[0-9]+$ ]]; then
    echo "$value"
    return 0
  fi
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "r${value}"
    return 0
  fi
  echo "$value"
}

normalize_pr_number() {
  local value="$1"
  if [[ -z "$value" ]]; then
    echo "#"
    return 0
  fi
  if [[ "$value" =~ ^#[0-9]+$ ]]; then
    echo "$value"
    return 0
  fi
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "#${value}"
    return 0
  fi
  echo "$value"
}

to_repo_relative() {
  local value="$1"
  if [[ "$value" == "$ROOT_DIR/"* ]]; then
    echo "${value#"$ROOT_DIR/"}"
    return 0
  fi
  echo "$value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="${2:-}"
      shift 2
      ;;
    --date=*)
      DATE="${1#*=}"
      shift 1
      ;;
    --run)
      RUN="${2:-}"
      shift 2
      ;;
    --run=*)
      RUN="${1#*=}"
      shift 1
      ;;
    --pr)
      PR_NUMBER="${2:-}"
      shift 2
      ;;
    --pr=*)
      PR_NUMBER="${1#*=}"
      shift 1
      ;;
    --screen-dir)
      SCREEN_DIR="${2:-}"
      shift 2
      ;;
    --screen-dir=*)
      SCREEN_DIR="${1#*=}"
      shift 1
      ;;
    --dry-run)
      DRY_RUN=1
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "template not found: $TEMPLATE_PATH" >&2
  exit 1
fi

if [[ -n "$RUN" ]]; then
  RUN="$(normalize_run "$RUN")"
fi

if [[ -z "$RUN" ]]; then
  for n in $(seq 1 99); do
    candidate="r${n}"
    candidate_file="${OUT_DIR}/${DATE}-mobile-regression-${candidate}.md"
    if [[ ! -e "$candidate_file" ]]; then
      RUN="$candidate"
      break
    fi
  done
fi

if [[ -z "$RUN" ]]; then
  echo "failed to choose run suffix (rN)" >&2
  exit 1
fi

LOG_FILENAME="${DATE}-mobile-regression-${RUN}.md"
LOG_PATH="${OUT_DIR}/${LOG_FILENAME}"
PR_LABEL="$(normalize_pr_number "$PR_NUMBER")"
GIT_REF="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

tmp_file=""
cleanup_tmp_file() {
  if [[ -n "${tmp_file:-}" && -f "$tmp_file" ]]; then
    rm -f "$tmp_file"
  fi
}
trap cleanup_tmp_file EXIT

SCREEN_DIR_LABEL=""
if [[ -n "$SCREEN_DIR" ]]; then
  SCREEN_DIR_LABEL="$(to_repo_relative "$SCREEN_DIR")"
else
  latest_capture_dir="$(find "$OUT_DIR" -maxdepth 1 -type d -name "${DATE}-frontend-e2e*" | sort | tail -n 1 || true)"
  if [[ -n "$latest_capture_dir" ]]; then
    SCREEN_DIR_LABEL="$(to_repo_relative "$latest_capture_dir")"
  fi
fi

if [[ "$DRY_RUN" == "1" ]]; then
  if [[ -e "$LOG_PATH" ]]; then
    echo "[dry-run] already exists: docs/test-results/${LOG_FILENAME}"
  else
    echo "[dry-run] create: docs/test-results/${LOG_FILENAME}"
  fi
else
  if [[ -e "$LOG_PATH" ]]; then
    echo "log file already exists: $LOG_PATH" >&2
    exit 1
  fi
  cp "$TEMPLATE_PATH" "$LOG_PATH"
  tmp_file="$(mktemp)"
  awk \
    -v prLabel="$PR_LABEL" \
    -v runDate="$DATE" \
    -v branch="$GIT_BRANCH" \
    -v ref="$GIT_REF" \
    '
      /^- PR:/ { print "- PR: `" prLabel "`"; next }
      /^- 実施日:/ { print "- 実施日: `" runDate "`"; next }
      /^- 対象ブランチ\/コミット:/ { print "- 対象ブランチ/コミット: `" branch " / " ref "`"; next }
      { print }
    ' "$LOG_PATH" >"$tmp_file"
  mv "$tmp_file" "$LOG_PATH"
  tmp_file=""

  echo "created: docs/test-results/${LOG_FILENAME}"
fi

echo
echo "PR本文記載例:"
echo "- 証跡ファイル: \`docs/test-results/${LOG_FILENAME}\`"
if [[ -n "$SCREEN_DIR_LABEL" ]]; then
  echo "- スクリーンショット格納: \`${SCREEN_DIR_LABEL}\`"
else
  echo "- スクリーンショット格納: \`docs/test-results/${DATE}-frontend-e2e-rN/\`"
fi
