# さくらVPS 試験稼働 env チェックリスト

## 目的

- さくらVPS 上の Quadlet 試験稼働で、どの env ファイルに何を設定するかを短時間で確認できるようにする。
- build-time / runtime / proxy / maintenance の責務を分離して記録する。

## 試用プロファイル

`private-smoke` と `https-trial` の責務・禁止設定・標準コマンドは [sakura-vps-trial-profiles](sakura-vps-trial-profiles.md) を正とする。

- `private-smoke`: Caddy / host publish / 実 OAuth / 外部送信を使わない非公開 smoke。`SAKURA_VPS_PROFILE=private-smoke` を backend env に置き、`./scripts/quadlet/check-env.sh --profile private-smoke` で検査する。
- `https-trial`: trial 専用 FQDN + HTTPS + trial 専用 OAuth client。`SAKURA_VPS_PROFILE=https-trial` を backend env に置き、`./scripts/quadlet/check-env.sh --profile https-trial` と `./scripts/quadlet/check-trial-readiness.sh --profile https-trial --include-proxy` で検査する。

## build-time

### `deploy/quadlet/env/erp4-frontend-build.env`

用途:

- frontend image build 時に `VITE_*` を焼き込む。

最低限確認するキー:

- `VITE_API_BASE`
- `VITE_ENABLE_SW`

必要時に設定するキー:

- `VITE_PUSH_PUBLIC_KEY`
- `VITE_GOOGLE_CLIENT_ID`（frontend が Google Identity Services を直接使う場合のみ）
- `VITE_FEATURE_TIMESHEET_GRID`

確認コマンド:

```bash
./scripts/quadlet/check-env.sh --skip-runtime --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env
```

Google OIDC をさくらVPS 実機で使う場合は FQDN + HTTPS の origin / redirect URI が前提です。導入前に [google-cloud-predeployment](google-cloud-predeployment.md) を確認し、Google OIDC の詳細作業は [google-oidc-google-cloud-console](google-oidc-google-cloud-console.md) を参照してください。

## runtime

### `~/.config/containers/systemd/erp4-postgres.env`

用途:

- PostgreSQL コンテナ起動時の DB 初期化。

最低限確認するキー:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`

### `~/.config/containers/systemd/erp4-backend.env`

用途:

- backend コンテナ起動時の本番相当設定。

最低限確認するキー:

- `DATABASE_URL`
- `PORT`
- `NODE_ENV`
- `AUTH_MODE`
- `ALLOWED_ORIGINS`
- `JWT_JWKS_URL` または `JWT_PUBLIC_KEY`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `GOOGLE_OIDC_CLIENT_ID`（任意。明示する場合は `JWT_AUDIENCE` と同値を推奨。未設定時は `JWT_AUDIENCE` を client ID として扱う実装）
- `GOOGLE_OIDC_CLIENT_SECRET`
- `GOOGLE_OIDC_REDIRECT_URI`
- `AUTH_FRONTEND_ORIGIN`
- `AUTH_SESSION_COOKIE_SECURE`
- `MAIL_TRANSPORT`

ローカル保存系で確認するキー:

- `PDF_PROVIDER`
- `PDF_STORAGE_DIR`
- `PDF_BASE_URL`
- `PDF_GDRIVE_FOLDER_ID`（copy-only applyまたは将来のgdrive provider時。実値は記録しない）
- `EVIDENCE_ARCHIVE_PROVIDER`
- `EVIDENCE_ARCHIVE_LOCAL_DIR`
- `EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID`（copy-only applyまたは将来のgdrive provider時。実値は記録しない）
- `CHAT_ATTACHMENT_PROVIDER`
- `CHAT_ATTACHMENT_LOCAL_DIR`
- `REPORT_STORAGE_DIR`
- `REPORT_GDRIVE_FOLDER_ID`（copy-only applyまたは将来のgdrive provider時。実値は記録しない）

非ChatのGoogle Drive設定では完全な`ERP4_GDRIVE_*` credential setを使い、旧`CHAT_ATTACHMENT_GDRIVE_*` aliasへfallbackしない。#1977のruntime integrationと#1981のcutover承認前はproviderをgdriveへ変更しない。

確認コマンド:

```bash
./scripts/quadlet/check-env.sh --profile https-trial
```

## proxy

### `~/.config/containers/systemd/erp4-caddy.env`

用途:

- Caddy の公開ドメイン / ACME 設定。

最低限確認するキー:

- `APP_DOMAIN`
- `API_DOMAIN`
- `ACME_EMAIL`

### `~/.config/containers/systemd/erp4-caddy.Caddyfile`

用途:

- frontend / backend の reverse proxy ルーティング。

確認コマンド:

```bash
./scripts/quadlet/check-proxy.sh
```

## maintenance

### `~/.config/containers/systemd/erp4-maintenance.env`

用途:

- config backup / prune / DB backup timer の共通設定。

最低限確認するキー:

- `ERP4_REPO_DIR`
- `QUADLET_BACKUP_DIR`
- `QUADLET_DB_BACKUP_DIR`

保持方針として確認するキー:

- `ERP4_BACKUP_INCLUDE_PROXY`
- `ERP4_BACKUP_KEEP_COUNT`
- `ERP4_BACKUP_KEEP_DAYS`
- `ERP4_DB_BACKUP_SKIP_GLOBALS`

### repository外のoffsite backup env

さくらobject storage向けの値はQuadlet envへ混在させず、repository外のmode 600・current owner・non-symlink fileで管理する。実値、credential、private endpoint、bucket識別子、GPG識別子はこのchecklistへ記載しない。

profile / target:

- `S3_PROVIDER=sakura`
- `S3_ENDPOINT_URL`（credentialを含まないHTTPS origin）
- `S3_BUCKET`
- `S3_PREFIX`
- `S3_REGION`
- `ENVIRONMENT`
- `BACKUP_RETENTION_CLASS`

暗号化 / manifest context:

- `GPG_RECIPIENT`
- `GPG_HOME`
- `GPG_REMOVE_PLAINTEXT`
- `COMMIT_SHA`
- `DB_VERSION`
- `SCHEMA_VERSION`
- `APP_VERSION`
- `S3_VERIFY_DOWNLOAD`

readiness / retention:

- `S3_EXECUTION_MODE`
- `S3_REAL_RUN_CONFIRM`
- `CHECK_WRITE`
- `S3_OPERATOR_EVIDENCE_FILE`
- `RETENTION_MIN_HOURLY`
- `RETENTION_MIN_DAILY`
- `RETENTION_MIN_WEEKLY`
- `RETENTION_MIN_MONTHLY`

real mode、write/delete probe、timer有効化、restore、retention applyは人間承認後にだけ実施する。標準手順は[backup-restore](backup-restore.md)を参照する。

## 受入前の最小確認順

1. `deploy/quadlet/env/erp4-frontend-build.env` を編集
2. `./scripts/quadlet/check-env.sh --skip-runtime --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env`
3. `./scripts/quadlet/build-images.sh`
4. `./scripts/quadlet/install-user-units.sh`
5. `~/.config/containers/systemd/` 配下の runtime / proxy / maintenance env を編集
6. `./scripts/quadlet/check-env.sh`
7. 必要時 `./scripts/quadlet/check-proxy.sh`
8. `./scripts/quadlet/start-stack.sh`
9. `./scripts/quadlet/check-trial-readiness.sh`

## 関連 Runbook

- 試験稼働手順: [sakura-vps-podman-trial](sakura-vps-podman-trial.md)
- 試験稼働 Go/No-Go: [sakura-vps-trial-checklist](sakura-vps-trial-checklist.md)
- HTTPS reverse proxy: [sakura-vps-https-proxy](sakura-vps-https-proxy.md)
