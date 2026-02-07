#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_DATE="${RUN_DATE:-$(date +%F)}"
ENV_NAME="${ENV_NAME:-staging}"
TO_ISO="${TO_ISO:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
FROM_ISO="${FROM_ISO:-}"
WINDOW_MINUTES="${WINDOW_MINUTES:-10}"
OUTPUT_FILE="${OUTPUT_FILE:-$ROOT_DIR/docs/test-results/${RUN_DATE}-chat-attachments-av-audit-${ENV_NAME}.md}"
REPORT_CMD="${REPORT_CMD:-node scripts/report-chat-attachments-av-metrics.mjs}"

if [[ -z "$FROM_ISO" ]]; then
  FROM_ISO="$(node -e "const to=new Date(process.argv[1]);const from=new Date(to.getTime()-24*60*60*1000);console.log(from.toISOString());" "$TO_ISO")"
fi

TMP_JSON="$(mktemp)"

(
  cd "$ROOT_DIR"
  eval "$REPORT_CMD --from=$FROM_ISO --to=$TO_ISO --window-minutes=$WINDOW_MINUTES --format=json" > "$TMP_JSON"
)

SUMMARY="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const t=data.totals;const w=data.windows;const p=data.scanDurationMs;const latest=w.latest||{};const out=[\`attempts=\${t.attempts}\`,\`uploaded=\${t.uploaded}\`,\`blocked=\${t.blocked}\`,\`scanFailed=\${t.scanFailed}\`,\`scanFailedRate=\${Number(t.scanFailedRatePct||0).toFixed(2)}%\`,\`scanP95=\${p.p95==null?'-':Number(p.p95).toFixed(2)}ms\`,\`violations_count=\${(w.violatedByScanFailedCount||[]).length}\`,\`violations_rate=\${(w.violatedByScanFailedRate||[]).length}\`,\`latest_attempts=\${latest.attempts??0}\`,\`latest_scanFailed=\${latest.scanFailed??0}\`,\`latest_scanFailedRate=\${latest.scanFailedRatePct==null?'0.00':Number(latest.scanFailedRatePct).toFixed(2)}%\`];console.log(out.join(' | '));" "$TMP_JSON")"

mkdir -p "$(dirname "$OUTPUT_FILE")"
cat > "$OUTPUT_FILE" <<MARKDOWN
# チャット添付AV 監査ログ集計（${ENV_NAME}）

## 実行情報
- 実行日: ${RUN_DATE}
- 環境: ${ENV_NAME}
- 期間: ${FROM_ISO} .. ${TO_ISO}
- 窓幅: ${WINDOW_MINUTES} 分
- 実行コマンド: \`${REPORT_CMD} --from=${FROM_ISO} --to=${TO_ISO} --window-minutes=${WINDOW_MINUTES} --format=json\`

## サマリ
- ${SUMMARY}

## 集計JSON
\`\`\`json
$(cat "$TMP_JSON")
\`\`\`
MARKDOWN

rm -f "$TMP_JSON"
echo "written: $OUTPUT_FILE"
