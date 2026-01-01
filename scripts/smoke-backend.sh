#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
USER_ID="${USER_ID:-demo-user}"
ROLES="${ROLES:-admin,mgmt}"
GROUP_IDS="${GROUP_IDS:-}"
PROJECT_CODE="SMOKE-$(date +%s)"

json_get() {
  if ! command -v python >/dev/null 2>&1; then
    echo "Error: python interpreter not found." >&2
    return 1
  fi

  python -c 'import json
import sys

if len(sys.argv) < 2:
    print("json_get error: path argument missing", file=sys.stderr)
    sys.exit(1)

path = sys.argv[1].split(".")
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError as exc:
    print(f"json_get error: failed to parse JSON: {exc}", file=sys.stderr)
    sys.exit(1)

for key in path:
    if data is None:
        break
    if key.isdigit():
        try:
            data = data[int(key)]
        except (IndexError, KeyError, TypeError, ValueError):
            data = None
            break
    else:
        if isinstance(data, dict):
            data = data.get(key)
        else:
            data = None
            break

print(data if data is not None else "")' "$1"
}

require_id() {
  local name=$1
  local value=$2
  if [[ -z "$value" ]]; then
    echo "Error: $name is empty" >&2
    exit 1
  fi
}

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
  curl -sSf \
    "${headers[@]}" \
    -X POST "$url" -d "$body"
}

get_json() {
  local url=$1
  local headers=(
    -H "x-user-id: $USER_ID"
    -H "x-roles: $ROLES"
  )
  if [[ -n "$GROUP_IDS" ]]; then
    headers+=(-H "x-group-ids: $GROUP_IDS")
  fi
  curl -sSf "${headers[@]}" "$url"
}

echo "[1/9] create project"
project_resp=$(post_json "$BASE_URL/projects" "{\"code\":\"$PROJECT_CODE\",\"name\":\"Smoke Project\"}")
project_id=$(echo "$project_resp" | json_get "id")
require_id "project_id" "$project_id"
echo "project_id=$project_id"

echo "[2/9] create vendor"
vendor_resp=$(post_json "$BASE_URL/vendors" "{\"code\":\"$PROJECT_CODE-V\",\"name\":\"Smoke Vendor\",\"status\":\"active\"}")
vendor_id=$(echo "$vendor_resp" | json_get "id")
require_id "vendor_id" "$vendor_id"
echo "vendor_id=$vendor_id"

echo "[3/9] create estimate and submit"
estimate_resp=$(post_json "$BASE_URL/projects/$project_id/estimates" '{"totalAmount":120000,"currency":"JPY","lines":[{"description":"Smoke line","quantity":1,"unitPrice":120000}]}' )
estimate_id=$(echo "$estimate_resp" | json_get "estimate.id")
require_id "estimate_id" "$estimate_id"
post_json "$BASE_URL/estimates/$estimate_id/submit" '{}' >/dev/null
echo "estimate_id=$estimate_id"

echo "[4/9] create invoice and submit/send"
invoice_resp=$(post_json "$BASE_URL/projects/$project_id/invoices" "{\"estimateId\":\"$estimate_id\",\"issueDate\":\"$(date +%F)\",\"totalAmount\":120000,\"currency\":\"JPY\",\"lines\":[{\"description\":\"Smoke line\",\"quantity\":1,\"unitPrice\":120000}]}")
invoice_id=$(echo "$invoice_resp" | json_get "id")
require_id "invoice_id" "$invoice_id"
post_json "$BASE_URL/invoices/$invoice_id/submit" '{}' >/dev/null
post_json "$BASE_URL/invoices/$invoice_id/send" '{}' >/dev/null
echo "invoice_id=$invoice_id"

echo "[5/9] create time entry"
work_date="$(date +%F)"
time_resp=$(post_json "$BASE_URL/time-entries" "{\"projectId\":\"$project_id\",\"userId\":\"$USER_ID\",\"workDate\":\"$work_date\",\"minutes\":120}")
time_id=$(echo "$time_resp" | json_get "id")
require_id "time_id" "$time_id"
echo "time_id=$time_id"

echo "[6/9] create expense and submit"
expense_resp=$(post_json "$BASE_URL/expenses" "{\"projectId\":\"$project_id\",\"userId\":\"$USER_ID\",\"category\":\"travel\",\"amount\":5000,\"currency\":\"JPY\",\"incurredOn\":\"$work_date\"}")
expense_id=$(echo "$expense_resp" | json_get "id")
require_id "expense_id" "$expense_id"
post_json "$BASE_URL/expenses/$expense_id/submit" '{}' >/dev/null
echo "expense_id=$expense_id"

echo "[7/9] create purchase order and submit"
po_resp=$(post_json "$BASE_URL/projects/$project_id/purchase-orders" "{\"vendorId\":\"$vendor_id\",\"issueDate\":\"$work_date\",\"dueDate\":\"$work_date\",\"currency\":\"JPY\",\"totalAmount\":80000,\"lines\":[]}")
po_id=$(echo "$po_resp" | json_get "id")
require_id "purchase_order_id" "$po_id"
post_json "$BASE_URL/purchase-orders/$po_id/submit" '{}' >/dev/null
echo "purchase_order_id=$po_id"

echo "[8/9] create vendor quote & invoice"
vendor_quote_resp=$(post_json "$BASE_URL/vendor-quotes" "{\"projectId\":\"$project_id\",\"vendorId\":\"$vendor_id\",\"quoteNo\":\"$PROJECT_CODE-Q\",\"issueDate\":\"$work_date\",\"currency\":\"JPY\",\"totalAmount\":90000}")
vendor_quote_id=$(echo "$vendor_quote_resp" | json_get "id")
require_id "vendor_quote_id" "$vendor_quote_id"
vendor_invoice_resp=$(post_json "$BASE_URL/vendor-invoices" "{\"projectId\":\"$project_id\",\"vendorId\":\"$vendor_id\",\"vendorInvoiceNo\":\"$PROJECT_CODE-VI\",\"receivedDate\":\"$work_date\",\"dueDate\":\"$work_date\",\"currency\":\"JPY\",\"totalAmount\":90000}")
vendor_invoice_id=$(echo "$vendor_invoice_resp" | json_get "id")
require_id "vendor_invoice_id" "$vendor_invoice_id"
post_json "$BASE_URL/vendor-invoices/$vendor_invoice_id/approve" '{}' >/dev/null

echo "[9/9] run alert job and approval check"
post_json "$BASE_URL/jobs/alerts/run" '{}' >/dev/null
approval_resp=$(get_json "$BASE_URL/approval-instances?projectId=$project_id")
approval_id=$(echo "$approval_resp" | json_get "items.0.id")
require_id "approval_id" "$approval_id"

echo "smoke ok"
