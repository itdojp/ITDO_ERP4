# ERP4 Backend PoC

## Setup
```
cd packages/backend
npm install
cp .env.example .env  # set DATABASE_URL
npx prisma generate
npm run dev
```

## API (PoC)
- health: GET /health
- auth mock: GET /me (x-user-id, x-roles headers)
- projects: GET/POST /projects
- estimates: POST /projects/:id/estimates, submit
- invoices: POST /projects/:id/invoices, submit, send
- purchase orders: POST /projects/:id/purchase-orders, submit, send
- vendor docs: POST /vendor-quotes, /vendor-invoices, approve
- time entries: GET/POST/PATCH /time-entries, submit
- expenses: GET/POST /expenses, submit
- leave: GET/POST /leave-requests
- daily reports & wellbeing: POST /daily-reports, /wellbeing-entries; GET wellbeing (HR only想定)
- alerts: GET /alerts, manual job: POST /jobs/alerts/run
- reports: GET /reports/project-effort, /reports/group-effort, /reports/overtime, /reports/delivery-due
- settings: alert-settings CRUD, approval-rules CRUD

## Notes
- Numbering: PYYYY-MM-NNNN per kind via number_sequences
- Auth/RBAC: header mock by default; JWT (OIDC) mode available
- Notifications: SMTP/SendGrid 設定があればメール送信、未設定なら stub
- PDF: ローカル生成 + `/pdf-files/:filename` で取得
- Validation: TypeBox for some routes; expand as needed

## Email (SMTP)
- env:
  - MAIL_TRANSPORT=smtp
  - MAIL_FROM=from@example.com
  - SMTP_HOST / SMTP_PORT / SMTP_SECURE
  - SMTP_USER / SMTP_PASS (optional)
- 備考: メール本文は現状プレースホルダ。実運用ではテンプレート化を前提にする。
- セキュリティ: SMTP資格情報は secrets manager 等で管理し、リポジトリにコミットしないこと。

## Email (SendGrid)
- env:
  - MAIL_TRANSPORT=sendgrid
  - MAIL_FROM=from@example.com
  - SENDGRID_API_KEY
  - SENDGRID_BASE_URL (optional)
- event webhook:
  - SENDGRID_EVENT_WEBHOOK_SECRET (optional)
  - SENDGRID_EVENT_MAX_BYTES / SENDGRID_EVENT_MAX_BATCH (optional)
  - POST `/webhooks/sendgrid/events` with header `x-erp4-webhook-key`
- 備考: 添付はbase64で送信するため、ファイルサイズに注意。

## Auth (JWT/OIDC)
- env:
  - AUTH_MODE=jwt|hybrid|header
  - JWT_JWKS_URL or JWT_PUBLIC_KEY
  - JWT_ISSUER / JWT_AUDIENCE / JWT_ALGS
  - JWT_*_CLAIM (roles/group_ids/project_ids/org_id)
  - AUTH_DEFAULT_ROLE (rolesが無い場合のデフォルト)
- 補足: hybridはAuthorizationが無い場合にヘッダ認証へフォールバックする。
- 注意: headerは開発用のモック。インターネット公開環境では使用しない。

## PDF
- env (local):
  - PDF_PROVIDER=local
  - PDF_STORAGE_DIR=/tmp/erp4/pdfs
  - PDF_BASE_URL=http://localhost:3001/pdf-files (未設定なら /pdf-files)
- asset limits:
  - PDF_ASSET_ALLOWED_HOSTS (optional)
  - PDF_ASSET_MAX_BYTES / PDF_DATA_URL_MAX_BYTES
  - PDF_ASSET_TIMEOUT_MS
- env (external):
  - PDF_PROVIDER=external
  - PDF_EXTERNAL_URL
  - PDF_EXTERNAL_API_KEY (optional)
  - PDF_EXTERNAL_MAX_BYTES / PDF_EXTERNAL_TIMEOUT_MS
- 備考: external は PDF バイナリを返すエンドポイントを想定。

### SMTP smoke test
```
npx ts-node --project packages/backend/tsconfig.json scripts/smoke-email.ts
```
