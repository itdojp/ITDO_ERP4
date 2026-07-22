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
- レート制限
  - グローバル
    - `RATE_LIMIT_ENABLED=1` で有効化（`NODE_ENV=production` は自動有効）
    - `RATE_LIMIT_MAX`（任意、既定: `600`）
    - `RATE_LIMIT_WINDOW`（任意、既定: `1 minute`）
  - 分散（複数インスタンス）構成
    - `RATE_LIMIT_REDIS_URL`（任意、`redis(s)://`）
    - `RATE_LIMIT_REDIS_NAMESPACE`（任意、既定: `erp4-rate-limit-`）
    - `RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS`（任意、既定: `3000`）
  - 高負荷APIの個別制限（任意、未指定時は既定値）
    - 検索: `RATE_LIMIT_SEARCH_MAX` / `RATE_LIMIT_SEARCH_WINDOW`
    - 外部LLM要約: `RATE_LIMIT_AI_SUMMARY_MAX` / `RATE_LIMIT_AI_SUMMARY_WINDOW`
    - チャット添付アップロード: `RATE_LIMIT_ATTACHMENT_UPLOAD_MAX` / `RATE_LIMIT_ATTACHMENT_UPLOAD_WINDOW`
    - 文書送信（見積/請求/発注）: `RATE_LIMIT_DOC_SEND_MAX` / `RATE_LIMIT_DOC_SEND_WINDOW`
    - 文書再送: `RATE_LIMIT_DOC_SEND_RETRY_MAX` / `RATE_LIMIT_DOC_SEND_RETRY_WINDOW`

セキュリティヘッダ/CORS（固定ポリシー）:

- CORS
  - `ALLOWED_ORIGINS` 設定時: 指定オリジンのみ許可
  - `ALLOWED_ORIGINS` 未設定/空: 全オリジン拒否（`Access-Control-Allow-Origin` を返さない）
- CSP（`@fastify/helmet`）
  - 既定: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self'`, `connect-src 'self'`, `font-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `base-uri 'self'`
  - 埋め込み要件などで `frame-ancestors` を変更する場合は、コード変更 + セキュリティレビューを必須とする

認証:

- `AUTH_MODE=header|jwt|hybrid|jwt_bff`（未設定時は `header`）
- `AUTH_ALLOW_HEADER_FALLBACK_IN_PROD`（任意、指定時は `true|false|1|0`）
- `NODE_ENV=production` では `AUTH_MODE=jwt_bff` のみ許可
- `AUTH_ALLOW_HEADER_FALLBACK_IN_PROD` は PoC・開発・限定運用向け。production の起動許可には使われない
- `AUTH_MODE=jwt_bff` でも、SCIM / webhook / 定期ジョブ用の route-level 認証と delegated JWT は利用可能
- `AUTH_MODE=jwt|hybrid|jwt_bff` の場合は以下を必須
  - `JWT_ISSUER`
  - `JWT_AUDIENCE`
  - `JWT_JWKS_URL` または `JWT_PUBLIC_KEY`（どちらか）
- `JWT_JWKS_URL` 指定時は `http(s)` URL 必須
- `AUTH_MODE=jwt_bff` の場合は以下も必須
  - `GOOGLE_OIDC_CLIENT_SECRET`
  - `GOOGLE_OIDC_REDIRECT_URI`
  - `AUTH_FRONTEND_ORIGIN`

チャット添付:

- `CHAT_ATTACHMENT_PROVIDER=local|gdrive`（既定: `local`）
- `CHAT_ATTACHMENT_PROVIDER=gdrive` の場合は以下を必須
  - `ERP4_GDRIVE_CLIENT_ID`
  - `ERP4_GDRIVE_CLIENT_SECRET`
  - `ERP4_GDRIVE_REFRESH_TOKEN`
  - `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID`
- 旧 `CHAT_ATTACHMENT_GDRIVE_CLIENT_ID` / `CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET` / `CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN` は deprecated な後方互換 fallback
  - 共通キーを1つでも設定した場合は完全な `ERP4_GDRIVE_*` 3点setを必須とし、旧キーとのfield単位の混在を拒否する。共通setがすべて未設定の場合だけ完全な旧setへfallbackし、両方が完全な場合は共通setを優先
  - 警告/エラーにはキー名だけを記録し、credential 値を出力しない
  - 少なくとも copy-only migration #1981 完了までは維持する。削除時期は #1981 完了後に別の breaking-change Issue / release note で決定し、#1976 では削除しない
- 保存先構成
  - Shared Drive: `ERP4_GDRIVE_SHARED_DRIVE_ID`（任意）に Drive ID、`CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` に Shared Drive 直下または専用 subfolder の folder ID を設定
  - My Drive: `ERP4_GDRIVE_SHARED_DRIVE_ID` は未設定とし、`CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` に専用 folder ID を設定
  - production は Shared Drive の専用 subfolder を推奨。Drive ID と folder ID は別の設定として扱う
- Google Drive tuning（任意、未指定時は既定値）
  - `ERP4_GDRIVE_TIMEOUT_MS`（既定: `30000`、範囲: `1..300000`）
  - `ERP4_GDRIVE_MAX_RETRIES`（既定: `3`、範囲: `0..10`）
  - `ERP4_GDRIVE_RETRY_BASE_DELAY_MS`（既定: `250`、範囲: `1..60000`。実待機は最大64秒にcap）
  - `ERP4_GDRIVE_RESUMABLE_UPLOAD_THRESHOLD_BYTES`（既定: `5242880` / 5MiB）
- PDF / Evidence archive / Reportのfolder契約はそれぞれ`PDF_GDRIVE_FOLDER_ID` / `EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID` / `REPORT_GDRIVE_FOLDER_ID`。非Chat contextは完全な`ERP4_GDRIVE_*` setだけを使い、旧Chat aliasへfallbackしない
- #1977でruntime実装まで提供するが、実folder preflight・copy-only照合・rollback windowを確認する#1981の承認前にproduction providerを切り替えない

メール通知:

- `MAIL_TRANSPORT=stub|smtp|sendgrid`（既定: `stub`）
- `MAIL_TRANSPORT=sendgrid` の場合
  - `SENDGRID_API_KEY` 必須
  - `SENDGRID_BASE_URL` 指定時は `http(s)` URL
  - `SENDGRID_ALLOWED_HOSTS`（任意、カンマ区切り）で送信先ホストを制限（未設定時は全ホスト許可）
  - `SENDGRID_TIMEOUT_MS`（任意、既定: `5000`）
  - `SENDGRID_ALLOW_HTTP` / `SENDGRID_ALLOW_PRIVATE_IP`（任意、既定: `false`）
- `MAIL_TRANSPORT=smtp` の場合
  - `SMTP_HOST` 必須
  - `SMTP_PORT` 必須（`1-65535`）
  - `SMTP_SECURE` 指定時は `true|false|1|0`

PDF:

- `PDF_PROVIDER=local|external|gdrive`（既定: `local`）
- `PDF_PROVIDER=gdrive`の場合、完全な`ERP4_GDRIVE_*` setと`PDF_GDRIVE_FOLDER_ID`が必須。生成物は共通artifact adapterへ保存し、ERP4の認可済みartifact endpointだけを返す
- `PDF_PROVIDER=external` の場合
  - `PDF_EXTERNAL_URL` 必須（`http(s)` URL）
  - `PDF_EXTERNAL_ALLOWED_HOSTS`（カンマ区切り）で送信先ホストを制限。production では必須で、`PDF_EXTERNAL_URL` の host を含める
  - `PDF_EXTERNAL_ALLOW_HTTP` / `PDF_EXTERNAL_ALLOW_PRIVATE_IP`（任意、既定: `false`。production では `false`）
- 画像アセット取得時（logo/signature）
  - `PDF_ASSET_ALLOWED_HOSTS`（任意、カンマ区切り）で取得先ホストを制限。production で HTTP(S) asset を使う場合は設定する
  - `PDF_ASSET_DIR`（任意）を設定した場合のみ local file asset をその配下から読み込む
  - `PDF_ASSET_ALLOW_HTTP` / `PDF_ASSET_ALLOW_PRIVATE_IP`（任意、既定: `false`。production では `false`）

Evidence Pack アーカイブ:

- `EVIDENCE_ARCHIVE_PROVIDER=local|s3|gdrive`（既定: `local`）
- `EVIDENCE_ARCHIVE_PROVIDER=gdrive`の場合、完全な`ERP4_GDRIVE_*` setと`EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID`が必須。contentとmetadataを別artifactとして保存する
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

Report生成物:

- `REPORT_PROVIDER=local|gdrive`（既定: `local`）
- `REPORT_PROVIDER=local`では`REPORT_STORAGE_DIR`を使用する
- `REPORT_PROVIDER=gdrive`では完全な`ERP4_GDRIVE_*` setと`REPORT_GDRIVE_FOLDER_ID`が必須。delivery payloadにはDrive URLではなくartifact UUIDを保存し、retry時は同じartifactを再利用する
- gdrive障害時にlocalへ暗黙fallbackしない。provider readinessは#1980の運用監視で判定し、process healthzとは分離する

Storage artifact migration:

- `PDF_GDRIVE_FOLDER_ID` / `EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID` / `REPORT_GDRIVE_FOLDER_ID`は、対応するruntime providerが`gdrive`の場合または実Google Driveへのmigration `--apply`時に必須
- helperはdry-run既定で、source削除・provider切替を行わない
- 詳細は[storage-artifact-migration](storage-artifact-migration.md)を参照

外部LLM（チャット）:

- `CHAT_EXTERNAL_LLM_PROVIDER=disabled|stub|openai`（既定: `disabled`）
- `CHAT_EXTERNAL_LLM_PROVIDER=openai` の場合
  - `CHAT_EXTERNAL_LLM_OPENAI_API_KEY` 必須
  - `CHAT_EXTERNAL_LLM_OPENAI_BASE_URL` 指定時は `http(s)` URL
  - `CHAT_EXTERNAL_LLM_ALLOWED_HOSTS`（任意、カンマ区切り）で接続先ホストを制限（未設定時は全ホスト許可）
  - `CHAT_EXTERNAL_LLM_ALLOW_HTTP` / `CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP`（任意、既定: `false`）

## バックアップ/リストア

参照:

- `docs/requirements/backup-restore.md`
- `docs/requirements/backup-restore.env.example`
