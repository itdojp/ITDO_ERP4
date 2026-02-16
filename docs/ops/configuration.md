# 設定（環境変数/シークレット）

## 基本方針

- シークレット（鍵/トークン）は GitHub にコミットしない
- 代表値は `.env.example` を参照し、実際の値は環境側で管理する

## backend（主要）

参照: `packages/backend/.env.example`

backend は起動時に環境変数の検証を行い、不正/不足があれば起動に失敗します。

### 起動時バリデーション対象（`packages/backend/src/services/envValidation.ts`）

基本:

- `DATABASE_URL`（必須、`postgresql://` または `postgres://`）
- `PORT`（任意、指定時は `1-65535`、未指定時は `3001`）
- `ALLOWED_ORIGINS`（任意、指定時は `http(s)` URL のカンマ区切り。未設定/空の場合は Fastify の CORS 設定で `origin: false` となり、全オリジン拒否）

認証:

- `AUTH_MODE=header|jwt|hybrid`（未設定時は `header`）
- `AUTH_MODE=jwt|hybrid` の場合は以下を必須
  - `JWT_ISSUER`
  - `JWT_AUDIENCE`
  - `JWT_JWKS_URL` または `JWT_PUBLIC_KEY`（どちらか）
- `JWT_JWKS_URL` 指定時は `http(s)` URL 必須

チャット添付:

- `CHAT_ATTACHMENT_PROVIDER=local|gdrive`（既定: `local`）
- `CHAT_ATTACHMENT_PROVIDER=gdrive` の場合は以下を必須
  - `CHAT_ATTACHMENT_GDRIVE_CLIENT_ID`
  - `CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET`
  - `CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN`
  - `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID`

メール通知:

- `MAIL_TRANSPORT=stub|smtp|sendgrid`（既定: `stub`）
- `MAIL_TRANSPORT=sendgrid` の場合
  - `SENDGRID_API_KEY` 必須
  - `SENDGRID_BASE_URL` 指定時は `http(s)` URL
- `MAIL_TRANSPORT=smtp` の場合
  - `SMTP_HOST` 必須
  - `SMTP_PORT` 必須（`1-65535`）
  - `SMTP_SECURE` 指定時は `true|false|1|0`

PDF:

- `PDF_PROVIDER=local|external`（既定: `local`）
- `PDF_PROVIDER=external` の場合
  - `PDF_EXTERNAL_URL` 必須（`http(s)` URL）

Evidence Pack アーカイブ:

- `EVIDENCE_ARCHIVE_PROVIDER=local|s3`（既定: `local`）
- `EVIDENCE_ARCHIVE_PROVIDER=s3` の場合
  - `EVIDENCE_ARCHIVE_S3_BUCKET` 必須
  - リージョンは以下いずれか必須
    - `EVIDENCE_ARCHIVE_S3_REGION`
    - `AWS_REGION`
    - `AWS_DEFAULT_REGION`
  - `EVIDENCE_ARCHIVE_S3_ENDPOINT_URL` 指定時は `http(s)` URL
  - `EVIDENCE_ARCHIVE_S3_FORCE_PATH_STYLE` 指定時は `true|false|1|0`
  - `EVIDENCE_ARCHIVE_S3_SSE` 指定時は `AES256|aws:kms`
  - `EVIDENCE_ARCHIVE_S3_SSE=aws:kms` の場合は `EVIDENCE_ARCHIVE_S3_KMS_KEY_ID` 必須

外部LLM（チャット）:

- `CHAT_EXTERNAL_LLM_PROVIDER=disabled|stub|openai`（既定: `disabled`）
- `CHAT_EXTERNAL_LLM_PROVIDER=openai` の場合
  - `CHAT_EXTERNAL_LLM_OPENAI_API_KEY` 必須
  - `CHAT_EXTERNAL_LLM_OPENAI_BASE_URL` 指定時は `http(s)` URL

## バックアップ/リストア

参照:

- `docs/requirements/backup-restore.md`
- `docs/requirements/backup-restore.env.example`
