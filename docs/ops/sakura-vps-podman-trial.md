# さくらVPS（Ubuntu）+ Podman + Quadlet 手順書

## 目的
- ITDO_ERP4 を 1 台のさくらVPS 上で rootless Podman + Quadlet により常駐運用する。
- PostgreSQL / backend / frontend を user systemd 管理へ寄せ、再起動後も自動復帰できる状態にする。

## 想定バージョン / 前提
- OS: Ubuntu 24.04 LTS
- Podman: 4.9 系
- systemd: 255 系
- Node.js: 20 LTS
- 作業ユーザー: `deploy`（`sudo` 可能）
- リポジトリ配置先: `/opt/itdo/ITDO_ERP4`
- 公開ポート:
  - frontend: `8080/tcp`
  - backend: `3001/tcp`
  - PostgreSQL: `127.0.0.1:55432/tcp` のみ

補足:
- frontend は nginx コンテナで静的配信します。`vite preview` は常駐運用に使いません。
- frontend の API 接続先は build-time に `VITE_API_BASE` へ焼き込まれます。
- backend の本番認証は `AUTH_MODE=jwt_bff` を前提にします。`AUTH_MODE=header` は公開環境では非推奨です。

## 1. OS 初期セットアップ

### 1-1. 基本更新
```bash
sudo apt update
sudo apt -y upgrade
sudo apt -y install git curl jq make ca-certificates uidmap slirp4netns passt fuse-overlayfs
```

### 1-2. Podman / Node.js
```bash
sudo apt -y install podman
podman --version

curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 20
nvm alias default 20
node -v
npm -v
```

### 1-3. rootless Podman 前提
```bash
id -un
grep "^$(id -un):" /etc/subuid /etc/subgid
```

不足している場合:
```bash
echo "deploy:100000:65536" | sudo tee -a /etc/subuid
echo "deploy:100000:65536" | sudo tee -a /etc/subgid
```

boot 後の user service 自動起動を有効化:
```bash
sudo loginctl enable-linger "$(id -un)"
```

## 2. ソース配置

```bash
sudo mkdir -p /opt/itdo
sudo chown "$(id -un)":"$(id -gn)" /opt/itdo
cd /opt/itdo
git clone https://github.com/itdojp/ITDO_ERP4.git
cd ITDO_ERP4
```

## 3. イメージ build

frontend build 用の env ファイルを用意します。

```bash
cp deploy/quadlet/env/erp4-frontend-build.env.example deploy/quadlet/env/erp4-frontend-build.env
vi deploy/quadlet/env/erp4-frontend-build.env
```

最低限修正する値:
- `VITE_API_BASE=http://YOUR_VPS_HOST:3001` または `https://api.example.com`
- `VITE_GOOGLE_CLIENT_ID`（Google OIDC を使う場合）
- `VITE_PUSH_PUBLIC_KEY`（Push 通知を使う場合）

build 前に frontend build 用 env だけ検証します。
```bash
./scripts/quadlet/check-env.sh --skip-runtime --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env
```

build:
```bash
./scripts/quadlet/build-images.sh
```

生成されるイメージ:
- `localhost/erp4-backend:latest`
- `localhost/erp4-frontend:latest`

## 4. Quadlet 配置

```bash
./scripts/quadlet/install-user-units.sh
```

配置先:
- `~/.config/containers/systemd/*.container`
- `~/.config/containers/systemd/*.network`
- `~/.config/containers/systemd/*.volume`
- `~/.config/containers/systemd/*.service`
- `~/.config/containers/systemd/erp4-postgres.env`
- `~/.config/containers/systemd/erp4-backend.env`

`erp4-postgres.env` の例:
```dotenv
POSTGRES_USER=erp4
POSTGRES_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
POSTGRES_DB=postgres
```

`erp4-backend.env` の最低限:
```dotenv
DATABASE_URL=postgresql://erp4:REPLACE_WITH_STRONG_PASSWORD@erp4-postgres:5432/postgres?schema=public
PORT=3001
NODE_ENV=production
AUTH_MODE=jwt_bff
ALLOWED_ORIGINS=https://app.example.com,http://YOUR_VPS_HOST:8080
JWT_JWKS_URL=https://YOUR_IDP/.well-known/jwks.json
JWT_ISSUER=https://YOUR_IDP/
JWT_AUDIENCE=YOUR_ERP4_AUDIENCE
GOOGLE_OIDC_CLIENT_SECRET=REPLACE_WITH_GOOGLE_CLIENT_SECRET
GOOGLE_OIDC_REDIRECT_URI=http://YOUR_VPS_HOST:3001/auth/google/callback
AUTH_FRONTEND_ORIGIN=http://YOUR_VPS_HOST:8080
AUTH_SESSION_COOKIE_SECURE=false
MAIL_TRANSPORT=stub
PDF_PROVIDER=local
PDF_STORAGE_DIR=/var/lib/erp4/pdfs
PDF_BASE_URL=http://YOUR_VPS_HOST:3001/pdf-files
EVIDENCE_ARCHIVE_PROVIDER=local
EVIDENCE_ARCHIVE_LOCAL_DIR=/var/lib/erp4/evidence-archives
CHAT_ATTACHMENT_PROVIDER=local
CHAT_ATTACHMENT_LOCAL_DIR=/var/lib/erp4/chat-attachments
REPORT_STORAGE_DIR=/var/lib/erp4/reports
```

補足:
- `DATABASE_URL` の host は `localhost` ではなく Podman network 上の `erp4-postgres` です。
- `ALLOWED_ORIGINS` には frontend の公開 origin を必ず含めます。
- backend は `erp4-backend-data.volume` を `/var/lib/erp4` へ mount します。PDF・Evidence archive・添付・report 出力先はこの配下に寄せます。

runtime env を編集したら、unit 起動前に検証します。
```bash
./scripts/quadlet/check-env.sh
```

## 5. 起動順

```bash
systemctl --user daemon-reload
systemctl --user enable --now erp4-postgres.service
systemctl --user enable --now erp4-migrate.service
systemctl --user enable --now erp4-backend.service
systemctl --user enable --now erp4-frontend.service
```

まとめて確認:
```bash
systemctl --user status erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service
```

## 6. 疎通確認

backend:
```bash
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS http://127.0.0.1:3001/readyz
```

frontend:
```bash
curl -I http://127.0.0.1:8080/
```

PostgreSQL:
```bash
podman exec erp4-postgres pg_isready -U erp4
```

## 7. 更新手順

アプリ更新:
```bash
cd /opt/itdo/ITDO_ERP4
git fetch origin
git checkout main
git pull --ff-only
./scripts/quadlet/build-images.sh
systemctl --user restart erp4-migrate.service
systemctl --user restart erp4-backend.service
systemctl --user restart erp4-frontend.service
```

DB migration を伴う更新では、`erp4-migrate.service` 完了を確認してから backend を再起動します。

## 8. ログ / 障害切り分け

```bash
journalctl --user -u erp4-postgres.service -f
journalctl --user -u erp4-migrate.service -f
journalctl --user -u erp4-backend.service -f
journalctl --user -u erp4-frontend.service -f
```

Podman 側:
```bash
podman ps
podman logs erp4-backend
podman logs erp4-frontend
podman logs erp4-postgres
```

よくある原因:
- `erp4-migrate.service` 失敗: `DATABASE_URL` / Prisma schema 差分 / DB 接続不可
- `erp4-backend.service` 失敗: `AUTH_MODE=jwt` に対して `JWT_*` が不足
- frontend だけ起動して API 呼び出しが失敗: `VITE_API_BASE` と `ALLOWED_ORIGINS` の不整合

ローカル smoke:
```bash
./scripts/quadlet/smoke-stack.sh
```

## 9. 品質確認

デプロイ前に最低限実行:
```bash
make lint
make format-check
make typecheck
make build
make test
make audit
```

## 10. 運用上の制約
- 単一 VPS 構成のため SPOF です。
- TLS は別の reverse proxy / LB で終端する前提です。
- PostgreSQL のバックアップ方針は `docs/ops/backup-restore.md` に従って別途設計してください。
- `AUTH_MODE=header` を公開環境で使う構成は、この手順の対象外です。
- HTTPS reverse proxy を前段に置く場合は `AUTH_SESSION_COOKIE_SECURE=true` へ戻してください。
