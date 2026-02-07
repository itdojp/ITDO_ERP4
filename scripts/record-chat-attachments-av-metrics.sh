#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_DATE="${RUN_DATE:-$(date +%F)}"
ENV_NAME="${ENV_NAME:-staging}"
TO_ISO="${TO_ISO:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
FROM_ISO="${FROM_ISO:-}"
WINDOW_MINUTES="${WINDOW_MINUTES:-10}"
THRESHOLD_SCAN_FAILED_COUNT="${THRESHOLD_SCAN_FAILED_COUNT:-5}"
THRESHOLD_SCAN_FAILED_RATE_PCT="${THRESHOLD_SCAN_FAILED_RATE_PCT:-1}"
THRESHOLD_SCAN_P95_MS="${THRESHOLD_SCAN_P95_MS:-5000}"
FAIL_ON_GATE="${FAIL_ON_GATE:-0}"
OUTPUT_FILE="${OUTPUT_FILE:-$ROOT_DIR/docs/test-results/${RUN_DATE}-chat-attachments-av-audit-${ENV_NAME}.md}"
REPORT_CMD_BIN="${REPORT_CMD_BIN:-node}"
REPORT_SCRIPT="${REPORT_SCRIPT:-scripts/report-chat-attachments-av-metrics.mjs}"

if [[ -z "$FROM_ISO" ]]; then
  FROM_ISO="$(node -e "const to=new Date(process.argv[1]);const from=new Date(to.getTime()-24*60*60*1000);console.log(from.toISOString());" "$TO_ISO")"
fi

TMP_JSON="$(mktemp)"

(
  cd "$ROOT_DIR"
  "$REPORT_CMD_BIN" "$REPORT_SCRIPT" \
    "--from=$FROM_ISO" \
    "--to=$TO_ISO" \
    "--window-minutes=$WINDOW_MINUTES" \
    "--threshold-scan-failed-count=$THRESHOLD_SCAN_FAILED_COUNT" \
    "--threshold-scan-failed-rate-pct=$THRESHOLD_SCAN_FAILED_RATE_PCT" \
    "--threshold-scan-p95-ms=$THRESHOLD_SCAN_P95_MS" \
    "--format=json" > "$TMP_JSON"
)

mapfile -t METRICS < <(
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const t=data.totals||{};const w=data.windows||{};const p=data.scanDurationMs||{};const latest=w.latest||{};const violationCount=(w.violatedByScanFailedCount||[]).length;const violationRate=(w.violatedByScanFailedRate||[]).length;const violationLatency=(w.violatedByScanDurationP95||[]).length;const gateStatus=(violationCount+violationRate+violationLatency)===0?'PASS':'FAIL';const summary=[\`attempts=\${t.attempts??0}\`,\`uploaded=\${t.uploaded??0}\`,\`blocked=\${t.blocked??0}\`,\`scanFailed=\${t.scanFailed??0}\`,\`scanFailedRate=\${Number(t.scanFailedRatePct||0).toFixed(2)}%\`,\`scanP95=\${p.p95==null?'-':Number(p.p95).toFixed(2)}ms\`,\`violations_count=\${violationCount}\`,\`violations_rate=\${violationRate}\`,\`violations_latency=\${violationLatency}\`,\`latest_attempts=\${latest.attempts??0}\`,\`latest_scanFailed=\${latest.scanFailed??0}\`,\`latest_scanFailedRate=\${latest.scanFailedRatePct==null?'0.00':Number(latest.scanFailedRatePct).toFixed(2)}%\`,\`latest_scanP95=\${latest.p95Ms==null?'-':Number(latest.p95Ms).toFixed(2)}ms\`].join(' | ');console.log(\`SUMMARY=\${summary}\`);console.log(\`VIOLATION_COUNT=\${violationCount}\`);console.log(\`VIOLATION_RATE=\${violationRate}\`);console.log(\`VIOLATION_LATENCY=\${violationLatency}\`);console.log(\`GATE_STATUS=\${gateStatus}\`);" \
    "$TMP_JSON"
)

SUMMARY=""
VIOLATION_COUNT=0
VIOLATION_RATE=0
VIOLATION_LATENCY=0
GATE_STATUS="FAIL"

for line in "${METRICS[@]}"; do
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    SUMMARY) SUMMARY="$value" ;;
    VIOLATION_COUNT) VIOLATION_COUNT="$value" ;;
    VIOLATION_RATE) VIOLATION_RATE="$value" ;;
    VIOLATION_LATENCY) VIOLATION_LATENCY="$value" ;;
    GATE_STATUS) GATE_STATUS="$value" ;;
  esac
done

mkdir -p "$(dirname "$OUTPUT_FILE")"
cat > "$OUTPUT_FILE" <<MARKDOWN
# チャット添付AV 監査ログ集計（${ENV_NAME}）

## 実行情報
- 実行日: ${RUN_DATE}
- 環境: ${ENV_NAME}
- 期間: ${FROM_ISO} .. ${TO_ISO}
- 窓幅: ${WINDOW_MINUTES} 分
- 閾値: scanFailedCount=${THRESHOLD_SCAN_FAILED_COUNT}, scanFailedRatePct=${THRESHOLD_SCAN_FAILED_RATE_PCT}, scanP95Ms=${THRESHOLD_SCAN_P95_MS}
- 実行コマンド: \`${REPORT_CMD_BIN} ${REPORT_SCRIPT} --from=${FROM_ISO} --to=${TO_ISO} --window-minutes=${WINDOW_MINUTES} --threshold-scan-failed-count=${THRESHOLD_SCAN_FAILED_COUNT} --threshold-scan-failed-rate-pct=${THRESHOLD_SCAN_FAILED_RATE_PCT} --threshold-scan-p95-ms=${THRESHOLD_SCAN_P95_MS} --format=json\`

## サマリ
- ${SUMMARY}

## 判定ゲート
- 判定: ${GATE_STATUS}
- 根拠: violations_count=${VIOLATION_COUNT}, violations_rate=${VIOLATION_RATE}, violations_latency=${VIOLATION_LATENCY}
- strictモード: FAIL_ON_GATE=${FAIL_ON_GATE}

## 集計JSON
\`\`\`json
$(cat "$TMP_JSON")
\`\`\`
MARKDOWN

rm -f "$TMP_JSON"
echo "written: $OUTPUT_FILE"

if [[ "$FAIL_ON_GATE" == "1" && "$GATE_STATUS" != "PASS" ]]; then
  echo "gate failed: $OUTPUT_FILE" >&2
  exit 2
fi
