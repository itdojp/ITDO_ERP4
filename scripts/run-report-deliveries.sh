#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
USER_ID="${USER_ID:-demo-user}"
ROLES="${ROLES:-admin,mgmt}"
GROUP_IDS="${GROUP_IDS:-}"
DRY_RUN="${DRY_RUN:-0}"

post_json() {
  local url=$1
  local body=$2
  local headers=(
    -H "Content-Type: application/json"
    -H "x-user-id: $USER_ID"
    -H "x-roles: $ROLES"
  )
  if [[ -n "$GROUP_IDS" ]]; then
    headers+=(-H "x-group-ids: $GROUP_IDS")
  fi
  curl -sSf "${headers[@]}" -X POST "$url" -d "$body"
}

payload='{}'
if [[ "$DRY_RUN" == "1" ]]; then
  payload='{"dryRun":true}'
fi

echo "[1/2] run report subscriptions (dryRun=$DRY_RUN)"
post_json "$BASE_URL/jobs/report-subscriptions/run" "$payload"

echo "[2/2] retry report deliveries (dryRun=$DRY_RUN)"
post_json "$BASE_URL/jobs/report-deliveries/retry" "$payload"

echo "report delivery jobs done"
