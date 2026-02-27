# さくらVPS（Ubuntu単体）+ Podman 試験動作手順書

## 目的
- ITDO_ERP4 を「さくらVPS 1台（Ubuntu）」で試験動作させる。
- DB は Podman 上の PostgreSQL を利用し、backend/frontend を同一VPSで起動する。

## 想定バージョン / 前提
- OS: Ubuntu 24.04 LTS（22.04 でも同等手順）
- Node.js: 20.19.0（CIと同一）
- Podman: Ubuntu標準パッケージ（24.04時点で 4.9 系）
- 作業ユーザー: `deploy`（sudo 権限あり）
- リポジトリ配置先: `/opt/itdo/ITDO_ERP4`

## 1. OS初期セットアップ

### 1-1. 基本更新と共通ツール
```bash
sudo apt update
sudo apt -y upgrade
sudo apt -y install git curl jq make ca-certificates unzip
```

### 1-2. Podman関連パッケージ
```bash
sudo apt -y install podman uidmap slirp4netns passt fuse-overlayfs
podman --version
```

### 1-3. Node.js 20.19.0 導入（nvm例）
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 20.19.0
nvm alias default 20.19.0
node -v
npm -v
```

## 2. rootless Podman 前提確認

### 2-1. subuid/subgid
```bash
id -un
grep "^$(id -un):" /etc/subuid /etc/subgid
```

`/etc/subuid` と `/etc/subgid` に対象ユーザー行が無い場合は追加する。

```bash
echo "deploy:100000:65536" | sudo tee -a /etc/subuid
echo "deploy:100000:65536" | sudo tee -a /etc/subgid
```

### 2-2. 動作確認
```bash
podman info
podman run --rm docker.io/library/hello-world
```

## 3. ソース配置と依存導入

```bash
sudo mkdir -p /opt/itdo
sudo chown "$(id -un)":"$(id -gn)" /opt/itdo
cd /opt/itdo
git clone https://github.com/itdojp/ITDO_ERP4.git
cd ITDO_ERP4

npm ci --prefix packages/backend
npm ci --prefix packages/frontend
```

## 4. DB（PostgreSQL）起動

このリポジトリの検証用スクリプトを使用する。

```bash
cd /opt/itdo/ITDO_ERP4
CONTAINER_NAME=erp4-pg-trial HOST_PORT=55432 \
DB_USER=erp4 DB_PASSWORD='REPLACE_WITH_STRONG_PASSWORD' \
./scripts/podman-poc.sh start

CONTAINER_NAME=erp4-pg-trial HOST_PORT=55432 \
DB_USER=erp4 DB_PASSWORD='REPLACE_WITH_STRONG_PASSWORD' \
./scripts/podman-poc.sh migrate
```

再起動後も DB コンテナを自動復帰させる場合（任意・rootless想定）:

1. コンテナに `--restart=always` を設定する:
```bash
podman update --restart=always erp4-pg-trial
```

2. rootless では boot 時に `systemd --user` から Podman を起動する設定が必要:
```bash
sudo loginctl enable-linger "$(id -un)"
mkdir -p ~/.config/systemd/user
cd /opt/itdo/ITDO_ERP4

podman generate systemd --name erp4-pg-trial --files --new
mv container-erp4-pg-trial.service ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable --now container-erp4-pg-trial.service
systemctl --user status container-erp4-pg-trial.service
```

接続先（backend用）:
- `DATABASE_URL=postgresql://erp4:REPLACE_WITH_STRONG_PASSWORD@localhost:55432/postgres?schema=public`

## 5. backend 起動

### 5-1. 環境変数ファイル作成
```bash
cd /opt/itdo/ITDO_ERP4
cp packages/backend/.env.example packages/backend/.env.vps
```

`packages/backend/.env.vps` の最小設定例:
```dotenv
DATABASE_URL=postgresql://erp4:REPLACE_WITH_STRONG_PASSWORD@localhost:55432/postgres?schema=public
PORT=3001
NODE_ENV=production
AUTH_MODE=jwt
ALLOWED_ORIGINS=https://app.example.com,http://<host>:4173
```

補足:
- `AUTH_MODE=header` はインターネット公開環境では非推奨。どうしても使う場合は、信頼できる reverse proxy 配下に限定し、`AUTH_ALLOW_HEADER_FALLBACK_IN_PROD=true` を明示する。
- `ALLOWED_ORIGINS` は frontend の実アクセス元（`vite preview` を使う場合は `http://<host>:4173`）を必ず含める。

### 5-2. build と起動
```bash
cd /opt/itdo/ITDO_ERP4
set -a; source packages/backend/.env.vps; set +a

npm run prisma:generate --prefix packages/backend
npm run build --prefix packages/backend
node packages/backend/dist/index.js
```

疎通確認:
```bash
curl -fsS http://127.0.0.1:3001/healthz
curl -fsS http://127.0.0.1:3001/readyz
```

## 6. frontend 起動

`VITE_API_BASE` は backend 公開URLに合わせる（例: `https://api.example.com`）。

```bash
cd /opt/itdo/ITDO_ERP4
VITE_API_BASE=https://api.example.com npm run build --prefix packages/frontend
npm run preview --prefix packages/frontend -- --host 0.0.0.0 --port 4173
```

## 7. 最低限の品質確認（試験稼働前）

```bash
cd /opt/itdo/ITDO_ERP4
make lint
make format-check
make typecheck
make build
make test
make audit
```

Podman連携の簡易確認（初期構築時のみ）:
```bash
make podman-smoke
```

## 8. 自動起動（任意・推奨）

再起動後の自動復帰が必要な場合は systemd user service を設定する。

```bash
loginctl enable-linger "$(id -un)"
mkdir -p ~/.config/systemd/user
```

### 8-1. backend service（例）
`~/.config/systemd/user/erp4-backend.service`
```ini
[Unit]
Description=ERP4 Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/itdo/ITDO_ERP4
EnvironmentFile=/opt/itdo/ITDO_ERP4/packages/backend/.env.vps
ExecStart=/usr/bin/bash -lc 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; node /opt/itdo/ITDO_ERP4/packages/backend/dist/index.js'
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

反映:
```bash
systemctl --user daemon-reload
systemctl --user enable --now erp4-backend.service
systemctl --user status erp4-backend.service
```

### 8-2. frontend service（例）
`~/.config/systemd/user/erp4-frontend.service`
```ini
[Unit]
Description=ERP4 Frontend (Vite Preview)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/itdo/ITDO_ERP4/packages/frontend
ExecStart=/usr/bin/bash -lc 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; npm run preview -- --host 0.0.0.0 --port 4173'
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

反映:
```bash
systemctl --user daemon-reload
systemctl --user enable --now erp4-frontend.service
systemctl --user status erp4-frontend.service
```

## 9. 運用上の注意
- 単一VPS構成はSPOFであり、本番可用性要件は満たさない。
- `scripts/podman-poc.sh reset` はDB初期化を伴うため、試験データ運用中は実行しない。
- 公開時は reverse proxy（TLS終端）とFW（許可ポート最小化）を必須にする。
- バックアップは `docs/ops/backup-restore.md` と `docs/requirements/backup-restore.md` に従う。
