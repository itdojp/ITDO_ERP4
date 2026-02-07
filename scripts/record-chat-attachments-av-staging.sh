#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RUN_DATE="${RUN_DATE:-$(date +%F)}"
ENV_NAME="${ENV_NAME:-staging}"
TO_ISO="${TO_ISO:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
FROM_ISO="${FROM_ISO:-}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/docs/test-results}"
SMOKE_OUTPUT_FILE="${SMOKE_OUTPUT_FILE:-$OUT_DIR/${RUN_DATE}-chat-attachments-av-${ENV_NAME}.md}"
METRICS_OUTPUT_FILE="${METRICS_OUTPUT_FILE:-$OUT_DIR/${RUN_DATE}-chat-attachments-av-audit-${ENV_NAME}.md}"

if [[ -z "$FROM_ISO" ]]; then
  FROM_ISO="$(node -e "const to=new Date(process.argv[1]);const from=new Date(to.getTime()-24*60*60*1000);console.log(from.toISOString());" "$TO_ISO")"
fi

mkdir -p "$OUT_DIR"

echo "[1/2] record smoke evidence"
(
  cd "$ROOT_DIR"
  RUN_DATE="$RUN_DATE" \
  ENV_NAME="$ENV_NAME" \
  OUTPUT_FILE="$SMOKE_OUTPUT_FILE" \
  SKIP_SMOKE="${SKIP_SMOKE:-0}" \
  bash scripts/record-chat-attachments-av-smoke.sh
)

echo "[2/2] record audit metrics evidence"
(
  cd "$ROOT_DIR"
  RUN_DATE="$RUN_DATE" \
  ENV_NAME="$ENV_NAME" \
  TO_ISO="$TO_ISO" \
  FROM_ISO="$FROM_ISO" \
  OUTPUT_FILE="$METRICS_OUTPUT_FILE" \
  bash scripts/record-chat-attachments-av-metrics.sh
)

echo "done:"
echo "- smoke: $SMOKE_OUTPUT_FILE"
echo "- metrics: $METRICS_OUTPUT_FILE"
