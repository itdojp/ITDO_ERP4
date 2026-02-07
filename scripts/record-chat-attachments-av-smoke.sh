#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_DATE="${RUN_DATE:-$(date +%F)}"
ENV_NAME="${ENV_NAME:-staging}"
OPERATOR="${OPERATOR:-$(git config user.name || true)}"
BACKEND_REVISION="${BACKEND_REVISION:-$(git rev-parse --short HEAD)}"
CLAMD_IMAGE="${CLAMD_IMAGE:-docker.io/clamav/clamav:latest}"
SMOKE_SCRIPT="${SMOKE_SCRIPT:-$ROOT_DIR/scripts/smoke-chat-attachments-av.sh}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"
OUTPUT_FILE="${OUTPUT_FILE:-$ROOT_DIR/docs/test-results/${RUN_DATE}-chat-attachments-av-${ENV_NAME}.md}"

if [[ -z "$OPERATOR" ]]; then
  OPERATOR="unknown"
fi

extract_status() {
  local pattern="$1"
  local value
  value="$(grep -E "$pattern" "$LOG_FILE" | tail -n 1 | sed -E 's/.*status=([0-9]+).*/\1/' || true)"
  if [[ -z "$value" ]]; then
    echo "-"
  else
    echo "$value"
  fi
}

LOG_FILE="$(mktemp)"
SMOKE_EXIT=0

if [[ "$SKIP_SMOKE" == "1" ]]; then
  echo "SKIP_SMOKE=1: smoke execution skipped" > "$LOG_FILE"
else
  if [[ ! -x "$SMOKE_SCRIPT" ]]; then
    echo "smoke script not executable: $SMOKE_SCRIPT" >&2
    exit 1
  fi

  set +e
  bash "$SMOKE_SCRIPT" 2>&1 | tee "$LOG_FILE"
  SMOKE_EXIT=${PIPESTATUS[0]}
  set -e
fi

CLEAN_UP_STATUS="$(extract_status 'upload clean \(clamd up\): status=')"
EICAR_STATUS="$(extract_status 'upload eicar \(clamd up\): status=')"
DOWN_STATUS="$(extract_status 'upload clean \(clamd down\): status=')"
ERROR_CODE="$(grep -E 'error_code=' "$LOG_FILE" | tail -n 1 | sed -E 's/.*error_code=([^[:space:]]+).*/\1/' || true)"

if [[ -z "$ERROR_CODE" ]]; then
  ERROR_CODE="-"
fi

if [[ "$SKIP_SMOKE" == "1" ]]; then
  RESULT_SUMMARY="未実行（SKIP_SMOKE=1）"
elif [[ "$SMOKE_EXIT" -eq 0 && "$CLEAN_UP_STATUS" == "200" && "$EICAR_STATUS" == "422" && "$DOWN_STATUS" == "503" ]]; then
  RESULT_SUMMARY="期待通り（200/422/503）"
elif [[ "$SMOKE_EXIT" -eq 0 ]]; then
  RESULT_SUMMARY="実行完了（要結果確認）"
else
  RESULT_SUMMARY="失敗（exit=${SMOKE_EXIT}）"
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

cat > "$OUTPUT_FILE" <<MARKDOWN
# チャット添付AV（${ENV_NAME}）検証

## 目的
- Issue #886 の本番有効化判定に必要な検証結果を記録する。

## 実行情報
- 実行日: ${RUN_DATE}
- 実行者: ${OPERATOR}
- 環境: ${ENV_NAME}
- backend revision: ${BACKEND_REVISION}
- clamd image / tag: ${CLAMD_IMAGE}
- 実行コマンド: \`bash scripts/smoke-chat-attachments-av.sh\`

## 結果サマリ
- clean 添付（clamd 稼働中）: ${CLEAN_UP_STATUS}
- EICAR 添付（clamd 稼働中）: ${EICAR_STATUS} / ${ERROR_CODE}
- clean 添付（clamd 停止後）: ${DOWN_STATUS}
- 結論: ${RESULT_SUMMARY}

## 実行ログ（末尾）
\`\`\`text
$(tail -n 120 "$LOG_FILE")
\`\`\`
MARKDOWN

rm -f "$LOG_FILE"

echo "written: $OUTPUT_FILE"
if [[ "$SMOKE_EXIT" -ne 0 ]]; then
  exit "$SMOKE_EXIT"
fi
