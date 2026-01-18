# 設定（環境変数/シークレット）

## 基本方針
- シークレット（鍵/トークン）は GitHub にコミットしない
- 代表値は `.env.example` を参照し、実際の値は環境側で管理する

## backend（主要）
参照: `packages/backend/.env.example`

backend は起動時に環境変数の検証を行い、不正/不足があれば起動に失敗します。

必須:
- `DATABASE_URL`: PostgreSQL 接続（例: `postgresql://...`）

任意（未設定の場合は既定値）:
- `PORT`: backend の待受ポート（既定: `3001`）
- `ALLOWED_ORIGINS`: CORS 許可（`,` 区切り、未設定の場合は拒否）

認証:
- `AUTH_MODE=header|jwt|hybrid`
- JWT運用時（`AUTH_MODE=jwt|hybrid`）は以下を必須とする
  - `JWT_ISSUER`
  - `JWT_AUDIENCE`
  - `JWT_JWKS_URL` または `JWT_PUBLIC_KEY`

可観測性:
- `LOG_LEVEL`（例: `info`）

レート制限（最小ハードニング）:
- `RATE_LIMIT_ENABLED=1`（明示的に有効化）
- もしくは `NODE_ENV=production` で有効化
- `RATE_LIMIT_MAX`（既定 600）
- `RATE_LIMIT_WINDOW`（既定 `1 minute`）

添付:
- `CHAT_ATTACHMENT_MAX_BYTES`（既定 10MB）
- `CHAT_ATTACHMENT_PROVIDER=local|gdrive`（既定: `local`）
  - `gdrive` の場合は以下が必須
    - `CHAT_ATTACHMENT_GDRIVE_CLIENT_ID`
    - `CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET`
    - `CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN`
    - `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID`

通知（メール）:
- `MAIL_TRANSPORT=stub|smtp|sendgrid`（既定: `stub`）
  - `sendgrid` の場合は `SENDGRID_API_KEY` が必須
  - `smtp` の場合は `SMTP_HOST` / `SMTP_PORT` が必須

PDF:
- `PDF_PROVIDER=local|external`（既定: `local`）
  - `external` の場合は `PDF_EXTERNAL_URL` が必須

## バックアップ/リストア
参照:
- `docs/requirements/backup-restore.md`
- `docs/requirements/backup-restore.env.example`
