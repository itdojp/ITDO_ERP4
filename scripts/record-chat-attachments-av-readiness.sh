#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_DATE="${RUN_DATE:-$(date +%F)}"
ENV_NAME="${ENV_NAME:-staging}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
SMOKE_OUTPUT_FILE="${SMOKE_OUTPUT_FILE:-$OUT_DIR/${RUN_DATE}-chat-attachments-av-${ENV_NAME}.md}"
METRICS_OUTPUT_FILE="${METRICS_OUTPUT_FILE:-$OUT_DIR/${RUN_DATE}-chat-attachments-av-audit-${ENV_NAME}.md}"
OUTPUT_FILE="${OUTPUT_FILE:-$OUT_DIR/${RUN_DATE}-chat-attachments-av-readiness-${ENV_NAME}.md}"
SKIP_RECORD="${SKIP_RECORD:-0}"

extract_value() {
  local file="$1"
  local prefix="$2"
  local line
  line="$(grep -F -- "$prefix" "$file" | head -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo "-"
    return
  fi
  echo "${line#"$prefix"}" | sed -E 's/^[[:space:]]+//'
}

if [[ "$SKIP_RECORD" != "1" ]]; then
  (
    cd "$ROOT_DIR"
    RUN_DATE="$RUN_DATE" \
    ENV_NAME="$ENV_NAME" \
    OUT_DIR="$OUT_DIR" \
    SMOKE_OUTPUT_FILE="$SMOKE_OUTPUT_FILE" \
    METRICS_OUTPUT_FILE="$METRICS_OUTPUT_FILE" \
    bash scripts/record-chat-attachments-av-staging.sh
  )
fi

if [[ ! -f "$SMOKE_OUTPUT_FILE" ]]; then
  echo "smoke evidence not found: $SMOKE_OUTPUT_FILE" >&2
  exit 1
fi
if [[ ! -f "$METRICS_OUTPUT_FILE" ]]; then
  echo "metrics evidence not found: $METRICS_OUTPUT_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

SMOKE_CLEAN_STATUS="$(extract_value "$SMOKE_OUTPUT_FILE" "- clean 添付（clamd 稼働中）: ")"
SMOKE_EICAR_STATUS="$(extract_value "$SMOKE_OUTPUT_FILE" "- EICAR 添付（clamd 稼働中）: ")"
SMOKE_DOWN_STATUS="$(extract_value "$SMOKE_OUTPUT_FILE" "- clean 添付（clamd 停止後）: ")"
SMOKE_CONCLUSION="$(extract_value "$SMOKE_OUTPUT_FILE" "- 結論: ")"
METRICS_GATE_STATUS="$(extract_value "$METRICS_OUTPUT_FILE" "- 判定: ")"
METRICS_GATE_REASON="$(extract_value "$METRICS_OUTPUT_FILE" "- 根拠: ")"

SMOKE_GATE_STATUS="FAIL"
if [[ "$SMOKE_CLEAN_STATUS" == "200" && "$SMOKE_EICAR_STATUS" == 422* && "$SMOKE_DOWN_STATUS" == "503" ]]; then
  SMOKE_GATE_STATUS="PASS"
fi

METRICS_TECH_GATE_STATUS="FAIL"
if [[ "$METRICS_GATE_STATUS" == "PASS" ]]; then
  METRICS_TECH_GATE_STATUS="PASS"
fi

TECHNICAL_GATE_STATUS="FAIL"
if [[ "$SMOKE_GATE_STATUS" == "PASS" && "$METRICS_TECH_GATE_STATUS" == "PASS" ]]; then
  TECHNICAL_GATE_STATUS="PASS"
fi

cat > "$OUTPUT_FILE" <<MARKDOWN
# チャット添付AV 本番有効化判定サマリ（${ENV_NAME}）

## 実行情報
- 実行日: ${RUN_DATE}
- 環境: ${ENV_NAME}
- smoke証跡: \`${SMOKE_OUTPUT_FILE}\`
- metrics証跡: \`${METRICS_OUTPUT_FILE}\`

## 技術ゲート判定
- 結果: ${TECHNICAL_GATE_STATUS}
- smokeゲート: ${SMOKE_GATE_STATUS}（clean up=${SMOKE_CLEAN_STATUS}, eicar=${SMOKE_EICAR_STATUS}, clean down=${SMOKE_DOWN_STATUS}）
- metricsゲート: ${METRICS_TECH_GATE_STATUS}（${METRICS_GATE_REASON}）

## 参考
- smoke結論: ${SMOKE_CONCLUSION}
- metrics判定: ${METRICS_GATE_STATUS}

## 未確定（運用判断が必要）
- provider方針（\`CHAT_ATTACHMENT_AV_PROVIDER=disabled\` 継続 or \`clamav\` 有効化）
- fail closed の業務許容可否（不可の場合の代替フロー定義）
- 定義更新方式の最終選定（\`freshclam --daemon\` / 定期ジョブ / イメージ更新）
- 監視/アラート閾値の最終確定（clamd死活、scan_failed、遅延/タイムアウト）
- 本番構成の最終確定（clamd配置、リソース）
MARKDOWN

echo "written: $OUTPUT_FILE"
