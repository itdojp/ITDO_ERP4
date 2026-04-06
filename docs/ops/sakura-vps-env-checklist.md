# さくらVPS 試験稼働 env チェックリスト

## 目的
- さくらVPS 上の Quadlet 試験稼働で、どの env ファイルに何を設定するかを短時間で確認できるようにする。
- build-time / runtime / proxy / maintenance の責務を分離して記録する。

## build-time
### `deploy/quadlet/env/erp4-frontend-build.env`
用途:
- frontend image build 時に `VITE_*` を焼き込む。

最低限確認するキー:
- `VITE_API_BASE`
- `VITE_ENABLE_SW`

必要時に設定するキー:
- `VITE_PUSH_PUBLIC_KEY`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_FEATURE_TIMESHEET_GRID`

確認コマンド:
```bash
./scripts/quadlet/check-env.sh --skip-runtime --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env
```

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
- `JWT_JWKS_URL`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `GOOGLE_OIDC_CLIENT_SECRET`
- `GOOGLE_OIDC_REDIRECT_URI`
- `AUTH_FRONTEND_ORIGIN`
- `AUTH_SESSION_COOKIE_SECURE`

ローカル保存系で確認するキー:
- `PDF_PROVIDER`
- `PDF_STORAGE_DIR`
- `PDF_BASE_URL`
- `EVIDENCE_ARCHIVE_PROVIDER`
- `EVIDENCE_ARCHIVE_LOCAL_DIR`
- `CHAT_ATTACHMENT_PROVIDER`
- `CHAT_ATTACHMENT_LOCAL_DIR`
- `REPORT_STORAGE_DIR`

確認コマンド:
```bash
./scripts/quadlet/check-env.sh
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
