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

通常起動:
```bash
./scripts/quadlet/start-stack.sh
```

proxy も起動する場合:
```bash
./scripts/quadlet/start-stack.sh --include-proxy
```

手動で分ける場合:
```bash
systemctl --user daemon-reload
systemctl --user enable --now erp4-postgres.service
systemctl --user enable --now erp4-migrate.service
systemctl --user enable --now erp4-backend.service
systemctl --user enable --now erp4-frontend.service
```

まとめて確認:
```bash
./scripts/quadlet/check-stack.sh
systemctl --user status erp4-postgres.service erp4-migrate.service erp4-backend.service erp4-frontend.service
```

稼働状況の一覧確認:
```bash
./scripts/quadlet/status-stack.sh
./scripts/quadlet/status-stack.sh --include-proxy
```

`start-stack.sh` は `check-env.sh` による runtime env 検証、user systemd unit の有効化・起動、`check-stack.sh` による post-start 検証を直列で実行します。`--include-proxy` を付け、かつ `--skip-env-check` を付けていない場合は、`check-proxy.sh` による Caddy 設定検証も追加で行ったうえで `erp4-caddy.service` を有効化・起動します。さらに `--skip-stack-check` を付けていない場合は、`status-stack.sh --include-proxy` による `erp4-caddy.service` を含む状態確認まで実行します。公開ドメイン経由の疎通まで確認したい場合は、`check-proxy.sh` または外部からの `curl` probe を別途実行してください。`QUADLET_TARGET_DIR` を設定している場合はその配下を検証対象に使います。手動の `systemctl --user enable --now ...` 群はトラブルシュート用の fallback として残しています。

`check-stack.sh` は backend health/readiness、frontend、PostgreSQL、および user systemd service を最大 60 秒・2 秒間隔で再試行しながら検証します。HTTP probe には残り時間ベースの timeout をかけているため、到達不能時でも無制限に待機しません。起動直後の偽陰性を避けたい場合は、個別 `curl` / `pg_isready` よりこちらを優先してください。


`status-stack.sh` は定常監視や切り分け向けの即時確認コマンドです。`erp4-postgres.service` / `erp4-migrate.service` / `erp4-backend.service` / `erp4-frontend.service` の active 状態を一覧し、必要に応じて `erp4-caddy.service` も含められます。あわせて backend health/readiness、frontend の HTTP HEAD、PostgreSQL の `pg_isready` を 1 回ずつ実行して結果を表示します。`--skip-systemd` を付けると user systemd 依存を外して runtime probe のみ確認できます。

停止する場合:
```bash
./scripts/quadlet/stop-stack.sh
./scripts/quadlet/stop-stack.sh --include-proxy
```

`stop-stack.sh` は依存の逆順で `erp4-frontend.service` / `erp4-backend.service` / `erp4-migrate.service` / `erp4-postgres.service` を停止します。`--include-proxy` を付けると `erp4-caddy.service` も先に停止します。`systemctl --user` の user bus が利用できない場合は、`sudo loginctl enable-linger <user>` を含む対処メッセージを返します。

再起動する場合:
```bash
./scripts/quadlet/restart-stack.sh
./scripts/quadlet/restart-stack.sh --include-proxy
```

`restart-stack.sh` は `stop-stack.sh` と `start-stack.sh` を直列実行します。`--include-proxy` を付けると `erp4-caddy.service` も再起動対象に含まれます。さらに `--skip-stack-check` を指定していない場合のみ、post-start 確認として `status-stack.sh --include-proxy` まで実行します。`--skip-env-check` と `--skip-stack-check` は `start-stack.sh` に透過的に渡されるため、`--skip-stack-check` 指定時は proxy を含む post-start の状態確認も省略されます。

自動起動設定ごと停止する場合:
```bash
./scripts/quadlet/disable-stack.sh
./scripts/quadlet/disable-stack.sh --include-proxy
```

`disable-stack.sh` は stack を停止したうえで、対象 unit の user systemd 自動起動設定も解除します。`--include-proxy` を付けると `erp4-caddy.service` も対象に含め、disable 後に明示停止します。メンテナンス期間中に reboot 後の自動復帰を止めたい場合はこちらを使います。再開時は `start-stack.sh` を実行し、proxy も無効化していた場合は `start-stack.sh --include-proxy` を使ってください。

Quadlet の unit 定義ファイル自体を取り除く場合:
```bash
./scripts/quadlet/uninstall-stack.sh
./scripts/quadlet/uninstall-stack.sh --include-proxy
./scripts/quadlet/uninstall-stack.sh --include-proxy --purge-config
```

`uninstall-stack.sh` は `disable-stack.sh` を先に実行したうえで、`~/.config/containers/systemd/` 配下の Quadlet unit 定義を削除し、最後に `systemctl --user daemon-reload` で user manager の定義キャッシュを更新します。既定では `erp4-postgres.env` / `erp4-backend.env` / `erp4-caddy.env` / `erp4-caddy.Caddyfile` / `erp4-frontend-build.env` は保持します。secret やドメイン設定、frontend build 用 env も消したい場合だけ `--purge-config` を使ってください。Podman volume やイメージ、アプリケーションデータ自体は削除しません。

## 5.1 設定バックアップ

stack の更新や uninstall 前に、`~/.config/containers/systemd/` 配下の env/config を tar.gz で退避できます。既定では backend/frontend/postgres 用の env を対象にし、`--include-proxy` で Caddy 設定、`--include-units` で Quadlet 定義も含めます。既定の出力先は `~/.local/share/erp4/quadlet-backups/` です。

```bash
./scripts/quadlet/backup-config.sh
./scripts/quadlet/backup-config.sh --include-proxy
./scripts/quadlet/backup-config.sh --include-proxy --include-units --output-dir ~/backups/erp4
./scripts/quadlet/backup-and-check.sh --print-archive
./scripts/quadlet/backup-and-check.sh --include-proxy --include-units --list --print-archive
```

`backup-and-check.sh` は `backup-config.sh` で archive を生成した直後に、同じ archive を `check-backup.sh` で検証します。生成される tar.gz には DB 接続情報や JWT secret などの機微情報が含まれる可能性があるため、保存先は第三者から見えない場所を選んでください。`backup-config.sh` は出力先ディレクトリを `0700`、archive を `0600` に寄せますが、外部へコピーする場合も同等の権限制御を前提にしてください。

復元する場合は、archive 内容を確認したうえで `restore-config.sh` を使います。既存ファイルがある場合は既定で停止するため、上書きが必要な場合だけ `--overwrite` を付けてください。unit 定義を含む archive を戻すときは、既定で `systemctl --user daemon-reload` まで実行します。

```bash
./scripts/quadlet/restore-config.sh --archive ~/.local/share/erp4/quadlet-backups/erp4-quadlet-config-YYYYMMDD-HHMMSS.tar.gz --list
./scripts/quadlet/restore-config.sh --archive ~/.local/share/erp4/quadlet-backups/erp4-quadlet-config-YYYYMMDD-HHMMSS.tar.gz
./scripts/quadlet/restore-config.sh --archive ~/.local/share/erp4/quadlet-backups/erp4-quadlet-config-YYYYMMDD-HHMMSS.tar.gz --overwrite
./scripts/quadlet/restore-latest.sh --list --print-archive
./scripts/quadlet/restore-latest.sh --print-archive
./scripts/quadlet/restore-latest.sh --overwrite --print-archive
```

バックアップ archive が増えた場合は、`prune-backups.sh` で保持数または保持日数に合わせて削除できます。`--keep-count` と `--keep-days` は併用でき、その場合はいずれかの条件を満たす archive を保持します。削除対象を先に確認したい場合は `--dry-run` を使ってください。

```bash
./scripts/quadlet/list-backups.sh
./scripts/quadlet/list-backups.sh --latest
./scripts/quadlet/list-backups.sh --limit 5
./scripts/quadlet/check-backup.sh --archive ~/.local/share/erp4/quadlet-backups/erp4-quadlet-config-YYYYMMDD-HHMMSS.tar.gz
./scripts/quadlet/check-backup.sh --archive ~/.local/share/erp4/quadlet-backups/erp4-quadlet-config-YYYYMMDD-HHMMSS.tar.gz --list
./scripts/quadlet/prune-backups.sh --keep-count 10 --dry-run
./scripts/quadlet/prune-backups.sh --keep-count 10
./scripts/quadlet/prune-backups.sh --keep-count 7 --keep-days 30
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
./scripts/quadlet/update-stack.sh
```

`update-stack.sh` は `build-images.sh` の実行後に `erp4-migrate.service` / `erp4-backend.service` / `erp4-frontend.service` を順に再起動し、必要なら `--include-proxy` で `erp4-caddy.service` も再起動します。post-update 確認は `check-stack.sh` を実行し、`--include-proxy` 指定時は追加で `status-stack.sh --include-proxy` を実行して proxy を含む稼働状況を確認します。`--skip-build` と `--skip-stack-check` を付けると、イメージ再ビルドや post-update 確認を個別に省略できます。`BUILD_IMAGES` / `CHECK_STACK` / `STATUS_STACK` / `SYSTEMCTL` を環境変数で差し替えると、ローカル検証や運用フローの置き換えがしやすくなります。

DB migration を伴う更新では、`erp4-migrate.service` 完了を確認してから backend を再起動します。

## 8. ログ / 障害切り分け

```bash
journalctl --user -u erp4-postgres.service -f
journalctl --user -u erp4-migrate.service -f
journalctl --user -u erp4-backend.service -f
journalctl --user -u erp4-frontend.service -f
```

まとめて確認する場合:
```bash
./scripts/quadlet/logs-stack.sh --follow
```

個別 unit や proxy を見る場合:
```bash
./scripts/quadlet/logs-stack.sh --service erp4-backend.service --lines 200
./scripts/quadlet/logs-stack.sh --service erp4-backend.service --include-proxy --follow
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

起動済み stack を手動確認する場合:
```bash
./scripts/quadlet/check-stack.sh --skip-systemd
```

状態を即時確認する場合:
```bash
./scripts/quadlet/status-stack.sh
./scripts/quadlet/status-stack.sh --include-proxy
./scripts/quadlet/status-stack.sh --skip-systemd
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
