#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

E2E_DATE="${E2E_DATE:-$(date +%Y-%m-%d)}"
E2E_RUN="${E2E_RUN:-}"

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

if [[ -n "$E2E_RUN" ]]; then
  E2E_RUN="$(normalize_run "$E2E_RUN")"
fi

if [[ -z "$E2E_RUN" ]]; then
  for n in $(seq 1 50); do
    candidate="r${n}"
    name="${E2E_DATE}-frontend-e2e-${candidate}"
    if [[ ! -e "$ROOT_DIR/docs/test-results/${name}" && ! -e "$ROOT_DIR/docs/test-results/${name}.md" ]]; then
      E2E_RUN="$candidate"
      break
    fi
  done
fi

if [[ -z "$E2E_RUN" ]]; then
  echo "failed to pick E2E_RUN (rN)" >&2
  exit 1
fi

EVIDENCE_NAME="${E2E_DATE}-frontend-e2e-${E2E_RUN}"
EVIDENCE_DIR="$ROOT_DIR/docs/test-results/${EVIDENCE_NAME}"
LOG_FILE="$ROOT_DIR/docs/test-results/${EVIDENCE_NAME}.md"

if [[ -e "$EVIDENCE_DIR" || -e "$LOG_FILE" ]]; then
  echo "evidence output already exists: $EVIDENCE_NAME" >&2
  echo "use E2E_RUN=r2 (or next) to avoid overwriting" >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/docs/test-results"
mkdir -p "$EVIDENCE_DIR"

# Default: UI evidence focused subset.
E2E_GREP_DEFAULT="frontend smoke|frontend offline queue|pwa offline duplicate time entries|pwa service worker cache refresh"
E2E_GREP="${E2E_GREP:-$E2E_GREP_DEFAULT}"

START_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_REF="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

cat >"$LOG_FILE" <<EOF
# フロントE2E（UIエビデンス ${E2E_RUN}）

- date: ${E2E_DATE}
- run: ${E2E_RUN}
- startedAt(UTC): ${START_AT_UTC}
- git: ${GIT_REF}
- evidence: docs/test-results/${EVIDENCE_NAME}/

## 実行コマンド
\`\`\`bash
E2E_CAPTURE=1 \\
E2E_EVIDENCE_DIR="\$PWD/docs/test-results/${EVIDENCE_NAME}" \\
E2E_GREP="${E2E_GREP}" \\
./scripts/e2e-frontend.sh
\`\`\`

## 結果
- status: (fill after run)
- notes:
EOF

set +e
E2E_CAPTURE=1 \
E2E_EVIDENCE_DIR="$EVIDENCE_DIR" \
E2E_GREP="$E2E_GREP" \
  "$ROOT_DIR/scripts/e2e-frontend.sh"
status=$?
set -e

FINISH_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$status" == "0" ]]; then
  sed "s/- status: (fill after run)/- status: PASS/" "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
else
  sed "s/- status: (fill after run)/- status: FAIL (exit=${status})/" "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

cat >>"$LOG_FILE" <<EOF

- finishedAt(UTC): ${FINISH_AT_UTC}
EOF

echo "ui evidence saved:"
echo "- $EVIDENCE_DIR"
echo "- $LOG_FILE"
echo
echo "mobile regression log helper:"
echo "- ./scripts/new-mobile-regression-log.sh --date ${E2E_DATE} --run ${E2E_RUN}"
exit "$status"
