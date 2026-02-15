# ERP4 Backend PoC

## Setup
```
cd packages/backend
npm install
cp .env.example .env  # set DATABASE_URL
npm run prisma:generate
npm run dev
```
本番ビルド確認: `npm run build && node dist/index.js`
補足: Prisma 7 は `prisma.config.ts` を利用します（`DATABASE_URL` が必須）。

## Tests
```
cd packages/backend
npm run test
```
- `npm run test` / `npm run test:ci` は `node --test` を直接実行せず、`scripts/run-tests.js` を経由します。
- `DATABASE_URL` が未設定の場合、tests 実行時のみ既定値を補完します（CIと同値）:
  - `postgresql://user:pass@localhost:5432/postgres?schema=public`
- `DATABASE_URL` を明示設定していれば、その値が優先されます（補完は行いません）。
- 注意: アプリの起動（`npm run dev` / `node dist/index.js`）では従来通り `DATABASE_URL` が必須です（安全性維持）。

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
- Notifications:
  - Email: SMTP/SendGrid 設定があれば送信、未設定なら stub
  - Slack/Webhook: `WEBHOOK_ALLOWED_HOSTS` 設定時のみ送信（未設定は skipped）
  - Push(WebPush): `POST /push-notifications/test` は VAPID 設定があれば実配信、未設定なら stub
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

## Slack/Webhook（外部通知）
- env:
  - WEBHOOK_ALLOWED_HOSTS=hooks.slack.com,example.com（ホスト名の完全一致。未設定は無効）
  - WEBHOOK_TIMEOUT_MS (optional; default 5000)
  - WEBHOOK_MAX_BYTES (optional; default 1048576)
  - WEBHOOK_ALLOW_HTTP / WEBHOOK_ALLOW_PRIVATE_IP (DEV-ONLY; optional)
- セキュリティ:
  - allowlist に含まれないホスト/プライベートIP宛は拒否（SSRF対策）
  - リダイレクトは追従せずエラー扱い（open redirect 経由のSSRF回避）
  - 本番で有効化する場合は送信先の統制（運用ルール/監査）を前提にする

## Push (WebPush)
- env:
  - VAPID_SUBJECT / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
  - フロント側は `VITE_PUSH_PUBLIC_KEY` に同じ公開鍵を設定する
- endpoints:
  - `POST /push-notifications/test`

## Auth (JWT/OIDC)
- env:
  - AUTH_MODE=jwt|hybrid|header
  - JWT_JWKS_URL or JWT_PUBLIC_KEY
  - JWT_ISSUER / JWT_AUDIENCE / JWT_ALGS
  - JWT_*_CLAIM (roles/group_ids/project_ids/org_id)
  - AUTH_DEFAULT_ROLE (rolesが無い場合のデフォルト)
- 補足: hybridはAuthorizationが無い場合にヘッダ認証へフォールバックする。
- 注意: headerは開発用のモック。インターネット公開環境では使用しない。

## SCIM (Provisioning)
- env:
  - SCIM_BEARER_TOKEN
  - SCIM_PAGE_MAX (optional)
- endpoints:
  - `/scim/v2/Users`, `/scim/v2/Groups`
  - `/scim/v2/ServiceProviderConfig`, `/scim/v2/ResourceTypes`
- 認証: `Authorization: Bearer <SCIM_BEARER_TOKEN>`

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

## Evidence Pack Archive
- env (local):
  - EVIDENCE_ARCHIVE_PROVIDER=local
  - EVIDENCE_ARCHIVE_LOCAL_DIR=/tmp/erp4/evidence-archives
- env (s3):
  - EVIDENCE_ARCHIVE_PROVIDER=s3
  - EVIDENCE_ARCHIVE_S3_BUCKET
  - EVIDENCE_ARCHIVE_S3_REGION（または AWS_REGION / AWS_DEFAULT_REGION）
  - EVIDENCE_ARCHIVE_S3_PREFIX（optional）
  - EVIDENCE_ARCHIVE_S3_ENDPOINT_URL（optional; S3互換ストレージ向け）
  - EVIDENCE_ARCHIVE_S3_FORCE_PATH_STYLE（optional）
  - EVIDENCE_ARCHIVE_S3_SSE / EVIDENCE_ARCHIVE_S3_KMS_KEY_ID（optional）
- API:
  - `POST /approval-instances/:id/evidence-pack/archive`
- 備考: content本体に加えて `.metadata.json` を同時保存し、digest/形式/対象versionを長期保全用に記録します。

### SMTP smoke test
```
npx ts-node --project packages/backend/tsconfig.json scripts/smoke-email.ts
```
