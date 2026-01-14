# PO→ERP4 データ移行ツール（PoC）

## 目的
- Project-Open（PO）のデータを ERP4 に一方向移行するための「実行ツール」を用意する。
- PoC/検証環境で繰り返し実行できる（再実行で重複しない・失敗箇所が分かる）ことを優先する。

## ツール
- `scripts/migrate-po.ts`

## 前提
- DB 接続は `DATABASE_URL` を使用する
- **書き込み実行**は `MIGRATION_CONFIRM=1` が必須
- `--apply` の場合、簡易整合チェック（件数一致/明細合計）を実行する

## 入力ディレクトリ
デフォルト: `tmp/migration/po`

以下のファイルが存在する場合に取り込みます（存在しないファイルはスキップ）。

- `customers.json`
- `vendors.json`
- `projects.json`
- `tasks.json`
- `milestones.json`
- `estimates.json`
- `invoices.json`
- `purchase_orders.json`
- `vendor_quotes.json`
- `vendor_invoices.json`
- `time_entries.json`
- `expenses.json`

※ まずは JSON（配列）を最小実装にしています。CSV 対応は後続で追加します。

## ID生成（決定的UUID）
再実行で重複しないよう、`legacyId` から **決定的UUID（uuidv5相当）** を生成して `id` に採用します。

- 例: `project` の `legacyId="im_projects:1001"` → `Project.id=uuidv5("erp4:po:project:im_projects:1001")`

## JSON スキーマ（最小）
### customers.json
```json
[
  {
    "legacyId": "im_customers:123",
    "code": "CUST-001",
    "name": "Example Customer",
    "status": "active",
    "invoiceRegistrationId": "T1234567890123",
    "taxRegion": "JP",
    "billingAddress": "..."
  }
]
```

### vendors.json
```json
[
  {
    "legacyId": "im_vendors:456",
    "code": "VND-001",
    "name": "Example Vendor",
    "status": "active",
    "bankInfo": "...",
    "taxRegion": "JP"
  }
]
```

### projects.json
```json
[
  {
    "legacyId": "im_projects:1001",
    "code": "PRJ-001",
    "name": "Example Project",
    "status": "active",
    "parentLegacyId": null,
    "customerLegacyId": "im_customers:123",
    "startDate": "2026-01-01",
    "endDate": "2026-03-31",
    "currency": "JPY",
    "planHours": 100,
    "budgetCost": 2000000
  }
]
```

### tasks.json
```json
[
  {
    "legacyId": "im_tasks:2001",
    "projectLegacyId": "im_projects:1001",
    "name": "Task A",
    "status": "todo",
    "parentLegacyId": null,
    "progressPercent": 10,
    "planStart": "2026-01-01",
    "planEnd": "2026-01-31"
  }
]
```

### milestones.json
```json
[
  {
    "legacyId": "im_phases:3001",
    "projectLegacyId": "im_projects:1001",
    "name": "Milestone 1",
    "amount": 120000,
    "billUpon": "acceptance",
    "dueDate": "2026-01-31",
    "taxRate": 0.1
  }
]
```

### estimates.json
```json
[
  {
    "legacyId": "im_estimates:6000",
    "projectLegacyId": "im_projects:1001",
    "estimateNo": null,
    "numberingDate": "2026-01-05",
    "version": 1,
    "totalAmount": 120000,
    "currency": "JPY",
    "status": "approved",
    "validUntil": "2026-02-15",
    "notes": "Imported estimate",
    "lines": [
      {
        "description": "Dev work",
        "quantity": 1,
        "unitPrice": 120000,
        "taxRate": 0.1,
        "taskLegacyId": "im_tasks:2001"
      }
    ]
  }
]
```

### invoices.json
```json
[
  {
    "legacyId": "im_invoices:7000",
    "projectLegacyId": "im_projects:1001",
    "invoiceNo": null,
    "issueDate": "2026-01-20",
    "dueDate": "2026-02-20",
    "currency": "JPY",
    "totalAmount": 120000,
    "status": "sent",
    "estimateLegacyId": "im_estimates:6000",
    "milestoneLegacyId": "im_phases:3001",
    "lines": [
      {
        "description": "Dev work",
        "quantity": 1,
        "unitPrice": 120000,
        "taxRate": 0.1,
        "taskLegacyId": "im_tasks:2001"
      }
    ]
  }
]
```

### purchase_orders.json
```json
[
  {
    "legacyId": "im_purchase_orders:8000",
    "projectLegacyId": "im_projects:1001",
    "vendorLegacyId": "im_vendors:456",
    "poNo": null,
    "issueDate": "2026-01-25",
    "dueDate": "2026-02-10",
    "currency": "JPY",
    "totalAmount": 90000,
    "status": "approved",
    "lines": [
      {
        "description": "Subcontract",
        "quantity": 1,
        "unitPrice": 90000,
        "taxRate": 0.1,
        "taskLegacyId": "im_tasks:2001"
      }
    ]
  }
]
```

### vendor_quotes.json
```json
[
  {
    "legacyId": "im_vendor_quotes:9000",
    "projectLegacyId": "im_projects:1001",
    "vendorLegacyId": "im_vendors:456",
    "quoteNo": null,
    "issueDate": "2026-01-10",
    "currency": "JPY",
    "totalAmount": 90000,
    "status": "received"
  }
]
```

### vendor_invoices.json
```json
[
  {
    "legacyId": "im_vendor_invoices:9100",
    "projectLegacyId": "im_projects:1001",
    "vendorLegacyId": "im_vendors:456",
    "vendorInvoiceNo": null,
    "receivedDate": "2026-02-01",
    "dueDate": "2026-02-28",
    "currency": "JPY",
    "totalAmount": 90000,
    "status": "received"
  }
]
```

### time_entries.json
```json
[
  {
    "legacyId": "im_time:4001",
    "projectLegacyId": "im_projects:1001",
    "taskLegacyId": "im_tasks:2001",
    "userId": "demo-user",
    "workDate": "2026-01-10",
    "minutes": 120,
    "status": "submitted"
  }
]
```

### expenses.json
```json
[
  {
    "legacyId": "im_expenses:5001",
    "projectLegacyId": "im_projects:1001",
    "userId": "demo-user",
    "category": "travel",
    "amount": 5000,
    "currency": "JPY",
    "incurredOn": "2026-01-10",
    "status": "approved"
  }
]
```

## 実行方法
### dry-run（デフォルト）
```bash
npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --input-dir=tmp/migration/po
```

### apply（DB書き込み）
```bash
export MIGRATION_CONFIRM=1
npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --input-dir=tmp/migration/po --apply
```

### 対象を絞る（例: projects と tasks のみ）
```bash
export MIGRATION_CONFIRM=1
npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --only=projects,tasks --apply
```

## 既知の制約（最小実装）
- CSV 取込は未対応（後続）
- `time_entries.userId` などのユーザIDの突合せは運用で決める必要がある
- 簡易整合チェックは `id in (...)` による件数一致チェックのため、巨大データでは時間/SQL制限の調整が必要になる可能性がある
- 見積/請求/発注の明細（lines）は apply 時に「全削除→再作成」で同期する（差分更新は未対応）
- 承認フロー（ApprovalInstance/Step）はこのツールでは作成しない（必要なら別途運用/後続対応）
