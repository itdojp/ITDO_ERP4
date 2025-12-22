#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
USER_ID="${USER_ID:-demo-user}"
PROJECT_CODE="SMOKE-$(date +%s)"

json_get() {
  python - "$1" <<'PY'
import json
import sys

path = sys.argv[1].split(".")
data = json.load(sys.stdin)
for key in path:
    if key.isdigit():
        data = data[int(key)]
    else:
        data = data.get(key)
print(data if data is not None else "")
PY
}

post_json() {
  local url=$1
  local body=$2
  curl -sS -H "Content-Type: application/json" -X POST "$url" -d "$body"
}

echo "[1/6] create project"
project_resp=$(post_json "$BASE_URL/projects" "{\"code\":\"$PROJECT_CODE\",\"name\":\"Smoke Project\"}")
project_id=$(echo "$project_resp" | json_get "id")
echo "project_id=$project_id"

echo "[2/6] create estimate and submit"
estimate_resp=$(post_json "$BASE_URL/projects/$project_id/estimates" '{"totalAmount":120000,"currency":"JPY","lines":[{"description":"Smoke line","quantity":1,"unitPrice":120000}]}' )
estimate_id=$(echo "$estimate_resp" | json_get "estimate.id")
post_json "$BASE_URL/estimates/$estimate_id/submit" '{}' >/dev/null
echo "estimate_id=$estimate_id"

echo "[3/6] create invoice and submit/send"
invoice_resp=$(post_json "$BASE_URL/projects/$project_id/invoices" "{\"estimateId\":\"$estimate_id\",\"issueDate\":\"$(date +%F)\",\"totalAmount\":120000,\"currency\":\"JPY\",\"lines\":[{\"description\":\"Smoke line\",\"quantity\":1,\"unitPrice\":120000}]}")
invoice_id=$(echo "$invoice_resp" | json_get "id")
post_json "$BASE_URL/invoices/$invoice_id/submit" '{}' >/dev/null
post_json "$BASE_URL/invoices/$invoice_id/send" '{}' >/dev/null
echo "invoice_id=$invoice_id"

echo "[4/6] create time entry"
work_date="$(date +%F)"
time_resp=$(post_json "$BASE_URL/time-entries" "{\"projectId\":\"$project_id\",\"userId\":\"$USER_ID\",\"workDate\":\"$work_date\",\"minutes\":120}")
time_id=$(echo "$time_resp" | json_get "id")
echo "time_id=$time_id"

echo "[5/6] create expense and submit"
expense_resp=$(post_json "$BASE_URL/expenses" "{\"projectId\":\"$project_id\",\"userId\":\"$USER_ID\",\"category\":\"travel\",\"amount\":5000,\"currency\":\"JPY\",\"incurredOn\":\"$work_date\"}")
expense_id=$(echo "$expense_resp" | json_get "id")
post_json "$BASE_URL/expenses/$expense_id/submit" '{}' >/dev/null
echo "expense_id=$expense_id"

echo "[6/6] run alert job"
post_json "$BASE_URL/jobs/alerts/run" '{}' >/dev/null

echo "smoke ok"
