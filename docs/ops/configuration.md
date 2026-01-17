# 設定（環境変数/シークレット）

## 基本方針
- シークレット（鍵/トークン）は GitHub にコミットしない
- 代表値は `.env.example` を参照し、実際の値は環境側で管理する

## backend（主要）
参照: `packages/backend/.env.example`

必須/重要:
- `DATABASE_URL`: PostgreSQL 接続
- `PORT`: backend の待受ポート
- `ALLOWED_ORIGINS`: CORS 許可（`,` 区切り）

認証:
- `AUTH_MODE=header|jwt|hybrid`
- `JWT_JWKS_URL` / `JWT_PUBLIC_KEY` / `JWT_ISSUER` / `JWT_AUDIENCE` など（JWT運用時）

可観測性:
- `LOG_LEVEL`（例: `info`）

レート制限（最小ハードニング）:
- `RATE_LIMIT_ENABLED=1`（明示的に有効化）
- もしくは `NODE_ENV=production` で有効化
- `RATE_LIMIT_MAX`（既定 600）
- `RATE_LIMIT_WINDOW`（既定 `1 minute`）

添付:
- `CHAT_ATTACHMENT_MAX_BYTES`（既定 10MB）

## バックアップ/リストア
参照:
- `docs/requirements/backup-restore.md`
- `docs/requirements/backup-restore.env.example`

