# さくらVPS（Ubuntu）+ Podman + Quadlet 手順書

## 目的

- ITDO_ERP4 を 1 台のさくらVPS 上で rootless Podman + Quadlet により常駐運用する。
- PostgreSQL / backend / frontend を user systemd 管理へ寄せ、再起動後も自動復帰できる状態にする。

この手順書は Quadlet stack の詳細手順です。導入前チェック、OS hardening、Secrets、backup、Go/No-Go を含む入口は [sakura-vps-deployment](sakura-vps-deployment.md) を使う。Google Cloud / Drive / OAuth の事前設定は [google-cloud-predeployment](google-cloud-predeployment.md) を先に確認する。試験稼働の Go/No-Go 判定だけを短時間で回したい場合は、別紙の [sakura-vps-trial-checklist](sakura-vps-trial-checklist.md) を使う。

関連資料:

- 導入 Runbook: [sakura-vps-deployment](sakura-vps-deployment.md)
- Google Cloud 事前設定: [google-cloud-predeployment](google-cloud-predeployment.md)
- env チェックリスト: [sakura-vps-env-checklist](sakura-vps-env-checklist.md)
- 試験稼働記録テンプレート: [../test-results/sakura-vps-trial-template.md](../test-results/sakura-vps-trial-template.md)

## 想定バージョン / 前提

- OS: Ubuntu 24.04 LTS
- Podman: 4.9 系
- systemd: 255 系
- Node.js: 20 LTS
- 作業ユーザー: `deploy`（`sudo` 可能）
- リポジトリ配置先: `/opt/itdo/ITDO_ERP4`
- 公開ポート:
  - Caddy proxy: `80/tcp`, `443/tcp`
  - PostgreSQL: `127.0.0.1:55432/tcp` のみ
  - backend / frontend は Quadlet network 内に閉じ、host へ直接公開しない

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

- `VITE_API_BASE`
  - plain HTTP の stack smoke のみ: `http://YOUR_VPS_HOST:3001`
  - Google OIDC を含む受入確認: `https://api.example.com`
- `VITE_GOOGLE_CLIENT_ID`（frontend が Google Identity Services を直接使う場合のみ。`AUTH_MODE=jwt_bff` の backend redirect フローだけなら不要）
- `VITE_PUSH_PUBLIC_KEY`（Push 通知を使う場合）

Google OIDC をさくらVPS 実機で使う場合、Google 側へ登録する origin / redirect URI は FQDN + HTTPS 前提です。`http://<VPS_IP>:3001/auth/google/callback` や raw IP origin は Google Auth Platform に登録できません。先に [sakura-vps-https-proxy](sakura-vps-https-proxy.md) と [google-oidc-google-cloud-console](google-oidc-google-cloud-console.md) を確認してください。

plain HTTP の `8080/3001` 構成は Podman stack 自体の smoke 確認用です。Google OIDC の実 login / session 維持 / CORS 確認は、HTTPS reverse proxy 導入後の `app.example.com` / `api.example.com` で実施してください。

build 前に frontend build 用 env だけ検証します。

```bash
./scripts/quadlet/check-env.sh --skip-runtime --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env
```

build:

```bash
./scripts/quadlet/build-images.sh
```

生成されるイメージは、既定では現在の Git commit 短縮 SHA を tag に使います。タグを明示したい場合は `ERP4_IMAGE_TAG` を設定します。

- `localhost/erp4-backend:<commit-sha>`
- `localhost/erp4-frontend:<commit-sha>`

```bash
ERP4_IMAGE_TAG="$(git rev-parse --short=12 HEAD)" ./scripts/quadlet/build-images.sh
```

`latest` tag は本番 Quadlet 手順では使いません。Containerfile の base image と Caddy/PostgreSQL image は digest 付き参照を使い、アプリケーション image は commit-derived tag を Quadlet unit へ展開します。

## 4. Quadlet 配置

profileを先に固定する。非公開試験は `private-smoke`、HTTPS試験は `https-trial`、従来の本番相当構成は `production` を使う。

```bash
PROFILE=private-smoke
ERP4_IMAGE_TAG="$(git rev-parse --short=12 HEAD)" \
  ./scripts/quadlet/install-user-units.sh --profile "$PROFILE"
```

`install-user-units.sh` は `deploy/quadlet/*.container` / `*.service` 内の `REPLACE_WITH_COMMIT_SHA` を `ERP4_IMAGE_TAG`（未指定時は現在の Git commit 短縮 SHA）で展開して配置します。`build-images.sh` と同じ tag を使うため、必要に応じて同じ `ERP4_IMAGE_TAG` を指定してください。
`private-smoke` では非公開PostgreSQL overlayを選択してCaddyを配置しません。既存のCaddy artifactがある場合、installerはエラー終了し、running serviceの停止やartifactの削除は行いません。profile切替時は事前にbackupを取得し、`disable-stack.sh --include-proxy` とRunbookに沿った明示的な退避・削除を行ってください。

配置先:

- `~/.config/containers/systemd/*.container`
- `~/.config/containers/systemd/*.network`
- `~/.config/containers/systemd/*.volume`
- `~/.config/containers/systemd/*.service`
- `~/.config/containers/systemd/*.timer`
- `~/.config/containers/systemd/erp4-postgres.env`
- `~/.config/containers/systemd/erp4-backend.env`

`.service` / `.timer` は設定バックアップとの互換性のため上記ディレクトリにも保持しますが、Quadlet generatorの対象ではありません。installerはsystemd user managerが読み込めるよう、同じnative unitへの管理対象symlinkを `~/.config/systemd/user/` に登録します。既存の通常ファイルまたは別の参照先を持つsymlinkと競合した場合は上書きせず停止します。検証用に配置先を分離する場合は `SYSTEMD_USER_TARGET_DIR` または `--systemd-user-target-dir` を明示してください。install/restore/uninstall helperは、相対指定されたQuadlet targetとsystemd user targetを現在の作業ディレクトリ基準の絶対pathへ正規化してからmanaged linkを操作します。

`erp4-postgres.env` の例:

```dotenv
POSTGRES_USER=erp4
POSTGRES_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
POSTGRES_DB=postgres
```

`erp4-backend.env` の最低限（Google OIDC + HTTPS reverse proxy を使う場合の例）:

```dotenv
DATABASE_URL=postgresql://erp4:REPLACE_WITH_STRONG_PASSWORD@erp4-postgres:5432/postgres?schema=public
PORT=3001
NODE_ENV=production
AUTH_MODE=jwt_bff
ALLOWED_ORIGINS=https://app.example.com
JWT_JWKS_URL=https://www.googleapis.com/oauth2/v3/certs
JWT_ISSUER=https://accounts.google.com
JWT_AUDIENCE=YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com
GOOGLE_OIDC_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com
GOOGLE_OIDC_CLIENT_SECRET=REPLACE_WITH_GOOGLE_CLIENT_SECRET
GOOGLE_OIDC_REDIRECT_URI=https://api.example.com/auth/google/callback
AUTH_FRONTEND_ORIGIN=https://app.example.com
AUTH_SESSION_COOKIE_SECURE=true
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
- plain HTTP の stack smoke では、この例をそのまま使わず、Google OIDC を伴う受入確認まで行う場合だけ HTTPS/FQDN 前提の値へ切り替えます。

runtime env を編集したら、unit 起動前に検証します。

```bash
./scripts/quadlet/check-env.sh --profile "$PROFILE"
```

任意で backup / prune / DB backup 用の maintenance env を編集します。
`erp4-maintenance.env` の例:

```dotenv
ERP4_REPO_DIR=/opt/itdo/ITDO_ERP4
QUADLET_BACKUP_DIR=/home/YOUR_USER/.local/share/erp4/quadlet-backups
QUADLET_DB_BACKUP_DIR=/home/YOUR_USER/.local/share/erp4/db-backups
ERP4_BACKUP_INCLUDE_PROXY=1
ERP4_BACKUP_KEEP_COUNT=14
ERP4_BACKUP_KEEP_DAYS=30
ERP4_DB_BACKUP_SKIP_GLOBALS=0
```

## 5. 起動順

通常起動:

```bash
./scripts/quadlet/start-stack.sh --profile "$PROFILE"
```

proxyを起動する場合は`private-smoke`のまま実行せず、HTTPS前提を満たした`https-trial`へ切り替えてunit/envを準備します。以下は初回起動前のprofile切替例です。

```bash
PROFILE=https-trial
ERP4_IMAGE_TAG="$(git rev-parse --short=12 HEAD)" \
  ./scripts/quadlet/install-user-units.sh --profile "$PROFILE"
./scripts/quadlet/check-env.sh --profile "$PROFILE"
./scripts/quadlet/start-stack.sh --profile "$PROFILE" --include-proxy
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

試験稼働の受入確認を 1 コマンドで回す場合は、次を使います。

```bash
./scripts/quadlet/check-trial-readiness.sh
./scripts/quadlet/check-trial-readiness.sh --include-proxy --resolve-ip <VPS_IP>
```

`check-trial-readiness.sh` は `check-host-prereqs.sh` → `check-env.sh` → `check-stack.sh` を順に実行し、`--include-proxy` 指定時だけ `check-https.sh` を追加します。DNS 切替前に公開ドメイン疎通を仮確認したい場合は `--resolve-ip` を使います。

試験稼働の証跡をまとめて採取する場合:

```bash
./scripts/quadlet/collect-trial-evidence.sh --lines 100
./scripts/quadlet/collect-trial-evidence.sh --include-proxy --resolve-ip <VPS_IP>
```

`collect-trial-evidence.sh` は `status-stack.sh` / `logs-stack.sh` / `systemctl --user list-timers 'erp4-*'` を timestamp 付きディレクトリへ保存し、`--include-proxy` 指定時だけ `check-https.sh` の結果も追加します。`status-stack.sh` や `check-https.sh` が失敗しても採取自体は継続し、最後に non-zero で終了します。

試験稼働記録のたたき台を生成する場合:

```bash
./scripts/record-sakura-vps-trial.sh
```

定期 backup を有効化する場合:

```bash
systemctl --user enable --now erp4-config-backup.timer
systemctl --user list-timers erp4-config-backup.timer
```

既定では毎日 03:15 に `erp4-config-backup.service` が実行され、`backup-and-check.sh --include-units` が呼ばれます。`ERP4_BACKUP_INCLUDE_PROXY=1` のときだけ proxy 設定も backup に含めます。backup 対象には `erp4-maintenance.env` / `erp4-storage-readiness.env` も含まれ、`--include-units` を付けた実行ではconfig backup、DB backup、config prune、storage readinessの各service/timerもarchiveに含まれます。

定期 DB backup を有効化する場合:

```bash
systemctl --user enable --now erp4-db-backup.timer
systemctl --user list-timers erp4-db-backup.timer
```

既定では毎日 04:15 に `erp4-db-backup.service` が実行され、`backup-db.sh` が PostgreSQL dump と globals dump を取得します。出力先は `erp4-maintenance.env` の `QUADLET_DB_BACKUP_DIR` で上書きでき、`ERP4_DB_BACKUP_SKIP_GLOBALS=1` を付けると globals dump を省略できます。globals dump にはロール/権限に加えてパスワードハッシュ等の機微情報が含まれる可能性があるため、`QUADLET_DB_BACKUP_DIR` は `0700` などの厳しい権限で管理し、保管/転送時は暗号化とアクセス制御を前提にしてください。現時点では DB backup 用の自動 prune は提供していないため、`enable-maintenance-timers.sh` の既定対象には含めていません。`erp4-db-backup.timer` を有効化する場合は、保持本数/保持日数を別途運用で決め、手動削除または外部ローテーションを併用してください。

定期 prune を有効化する場合:

```bash
systemctl --user enable --now erp4-config-prune.timer
systemctl --user list-timers erp4-config-prune.timer
```

backup / prune timer をまとめて有効化する場合:

```bash
./scripts/quadlet/enable-maintenance-timers.sh
```

backup / prune timer をまとめて無効化する場合:

```bash
./scripts/quadlet/disable-maintenance-timers.sh
```

backup / prune timer の状態を確認する場合:

```bash
./scripts/quadlet/status-maintenance-timers.sh
```

backup / prune を手動で 1 回実行する場合:

```bash
./scripts/quadlet/run-maintenance-now.sh --include-units
```

`run-maintenance-now.sh` は `ERP4_BACKUP_INCLUDE_PROXY=1` が設定されている場合、明示指定しなくても proxy 設定を backup 対象に含めます。`--include-proxy` を付けると環境変数設定が無い場合でも強制的に proxy 設定を含めます。`--skip-backup` で prune だけを実行する場合も、backup archive が 1 件も無ければ no-op 成功で終了します。

既定では毎日 03:45 に `erp4-config-prune.service` が実行され、`prune-backups.sh --keep-count "${ERP4_BACKUP_KEEP_COUNT:-14}" --keep-days "${ERP4_BACKUP_KEEP_DAYS:-30}"` 相当の整理を行います。保持本数と保持日数は `erp4-maintenance.env` の `ERP4_BACKUP_KEEP_COUNT` / `ERP4_BACKUP_KEEP_DAYS` で上書きできます。backup archive が 1 件も無い場合は no-op 成功として扱い、timer を失敗状態にしません。

`check-stack.sh` は backend health/readiness、frontend、PostgreSQL、および user systemd service を最大 60 秒・2 秒間隔で再試行しながら検証します。backend/frontend は既定で host port を公開せず Caddy ingress の背後に置くため、URL を明示しない場合は `podman exec` によるコンテナ内 probe を使います。`BACKEND_HEALTH_URL` / `BACKEND_READY_URL` / `FRONTEND_URL` または対応する CLI option を指定した場合だけ、Caddy/public endpoint などの明示 URL を `curl` で検証します。HTTP probe には残り時間ベースの timeout をかけているため、到達不能時でも無制限に待機しません。起動直後の偽陰性を避けたい場合は、個別 `curl` / `pg_isready` よりこちらを優先してください。

`status-stack.sh` は定常監視や切り分け向けの即時確認コマンドです。`erp4-postgres.service` / `erp4-migrate.service` / `erp4-backend.service` / `erp4-frontend.service` の active 状態を一覧し、必要に応じて `erp4-caddy.service` も含められます。あわせて backend health/readiness、frontend、PostgreSQL の `pg_isready` を 1 回ずつ実行して結果を表示します。backend/frontend の既定 probe は `check-stack.sh` と同じくコンテナ内で実行されます。`--skip-systemd` を付けると user systemd 依存を外して runtime probe のみ確認できます。

停止する場合:

```bash
./scripts/quadlet/stop-stack.sh
./scripts/quadlet/stop-stack.sh --include-proxy
```

`stop-stack.sh` は依存の逆順で `erp4-frontend.service` / `erp4-backend.service` / `erp4-migrate.service` / `erp4-postgres.service` を停止します。`--include-proxy` を付けると `erp4-caddy.service` も先に停止します。`systemctl --user` の user bus が利用できない場合は、`sudo loginctl enable-linger <user>` を含む対処メッセージを返します。

再起動する場合:

```bash
./scripts/quadlet/restart-stack.sh --profile "$PROFILE"
./scripts/quadlet/restart-stack.sh --profile "$PROFILE" --include-proxy
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

`uninstall-stack.sh` は `disable-stack.sh` を先に実行したうえで、installerが登録したmigrate、backup、prune、storage readinessのnative service/timerを停止・無効化します。その後、`~/.config/containers/systemd/` 配下の管理対象unit定義、PostgreSQL unit state、`~/.config/systemd/user/` 配下の管理対象symlinkを削除し、最後に `systemctl --user daemon-reload` でuser managerの定義キャッシュを更新します。別の参照先を持つsymlinkや通常ファイルは停止・削除しません。既定では `erp4-postgres.env` / `erp4-backend.env` / `erp4-frontend-build.env` / `erp4-maintenance.env` / `erp4-storage-readiness.env` と、proxy用の `erp4-caddy.env` / `erp4-caddy.Caddyfile` を保持します。これらのsecret、保守設定、ドメイン設定、frontend build用envも消したい場合だけ `--purge-config` を使ってください。Podman volumeやイメージ、アプリケーションデータ自体は削除しません。

## 5.1 設定バックアップ

stack の更新や uninstall 前に、`~/.config/containers/systemd/` 配下の env/config を tar.gz で退避できます。既定ではbackend、frontend build、PostgreSQL、maintenance、storage readiness用のenvを対象にし、`--include-proxy` でCaddy設定、`--include-units` でQuadlet定義も含めます。maintenanceとstorage readinessのenvにはbackup保存先、保持設定、provider/readiness設定などの機微情報が含まれ得るため、archive全体をsecretとして扱います。既定の出力先は `~/.local/share/erp4/quadlet-backups/` です。

```bash
./scripts/quadlet/backup-config.sh
./scripts/quadlet/backup-config.sh --include-proxy
./scripts/quadlet/backup-config.sh --include-proxy --include-units --output-dir ~/backups/erp4
./scripts/quadlet/backup-and-check.sh --print-archive
./scripts/quadlet/backup-and-check.sh --include-proxy --include-units --list --print-archive
```

`backup-and-check.sh` は `backup-config.sh` で archive を生成した直後に、同じ archive を `check-backup.sh` で検証します。既定link modeのunitは、`deploy/quadlet/` 配下を参照するinstaller管理symlinkだけをdereferenceし、archive内ではregular fileとして保存します。env/config symlinkや管理対象外を指すunit symlinkはfail-closedで拒否します。`--include-units` はstorage readinessのservice/timerも含み、復元元repositoryがなくてもunit定義を復元できます。生成されるtar.gzにはDB接続情報やJWT secretなどの機微情報が含まれる可能性があるため、保存先は第三者から見えない場所を選んでください。`backup-config.sh` は出力先ディレクトリを `0700`、archiveを `0600` に寄せますが、外部へコピーする場合も同等の権限制御を前提にしてください。

復元する場合は、archive 内容を確認したうえで `restore-config.sh` を使います。既存ファイルがある場合は既定で停止するため、上書きが必要な場合だけ `--overwrite` を付けてください。unit 定義を含む archive を戻すときは、migrate、backup、prune、storage readinessのnative service/timerを `SYSTEMD_USER_TARGET_DIR`（既定 `~/.config/systemd/user/`）へ管理対象symlinkとして再登録してから、`systemctl --user daemon-reload` を実行します。既存の通常ファイルまたは別の参照先を持つsymlinkとは競合前に停止し、部分復元しません。検証用に配置先を分離する場合は `--systemd-user-target-dir` を指定してください。`--skip-daemon-reload`はreloadだけを省略し、symlink登録は省略しません。

```bash
./scripts/quadlet/restore-config.sh --archive ~/.local/share/erp4/quadlet-backups/erp4-quadlet-config-YYYYMMDD-HHMMSS.tar.gz --list
./scripts/quadlet/restore-config.sh --archive ~/.local/share/erp4/quadlet-backups/erp4-quadlet-config-YYYYMMDD-HHMMSS.tar.gz
./scripts/quadlet/restore-config.sh --archive ~/.local/share/erp4/quadlet-backups/erp4-quadlet-config-YYYYMMDD-HHMMSS.tar.gz --overwrite
./scripts/quadlet/restore-latest.sh --list --print-archive
./scripts/quadlet/restore-latest.sh --print-archive
./scripts/quadlet/restore-latest.sh --overwrite --print-archive
./scripts/quadlet/rollback-latest.sh --profile "$PROFILE" --print-archive --skip-restart
./scripts/quadlet/rollback-latest.sh --profile "$PROFILE" --include-proxy --skip-env-check
```

検証用に native systemd user unit の配置先を既定以外へ分離している場合は、`restore-latest.sh` / `rollback-latest.sh` にも `--systemd-user-target-dir <dir>` を付けて、復元時のmanaged symlink再登録先を install/uninstall と一致させてください。

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

backend/frontend は既定で host port を公開しません。通常は stack check を使って、backend/frontend はコンテナ内、PostgreSQL は `podman exec` で確認します。

```bash
./scripts/quadlet/check-stack.sh
./scripts/quadlet/status-stack.sh --skip-systemd
```

Caddy ingress まで含めて公開経路を確認する場合は、`check-https.sh` または `BACKEND_HEALTH_URL` / `BACKEND_READY_URL` / `FRONTEND_URL` に Caddy/public endpoint を指定した `check-stack.sh` を使います。

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
# 次のいずれか 1 つを選んで実行
./scripts/quadlet/update-stack.sh --profile "$PROFILE"
./scripts/quadlet/update-stack.sh --profile "$PROFILE" --backup-before-update
./scripts/quadlet/update-stack.sh --profile "$PROFILE" --backup-before-update --include-proxy
```

`update-stack.sh` は必要に応じて `--backup-before-update` で `backup-and-check.sh --include-units` を先行実行し、その後 `build-images.sh` とprofile-awareなunit installを実行して、`erp4-migrate.service` / `erp4-backend.service` / `erp4-frontend.service` を順に再起動します。`start-stack.sh` / `update-stack.sh` は最後に正常起動したPostgreSQL unitのcontent hashをowner-onlyのregular file `erp4-postgres-unit.sha256` へ原子的に記録します。symlinkやdirectoryなどregular file以外の既存state pathはlifecycle操作前に拒否します。更新時のdesired hashが記録値と異なる場合だけ `erp4-postgres.service` も先に再起動し、`pg_isready` 成功後に記録値を更新してmigrationへ進みます。これによりproduction/https-trialとprivate-smokeの切替だけでなく、既定link-modeで同じsource pathの内容が変わった場合も旧定義を残しません。state fileが未作成の既存環境では初回update時に安全側で1回再起動します。このstate fileはsecretや復元入力ではないためbackup archiveへ含めず、start/restart/rollback後に現在のunitから再生成します。`--include-proxy` を付けるとbackup対象にもproxy設定を含め、`erp4-caddy.service` も再起動します。post-update確認は `check-stack.sh` を実行し、`--include-proxy` 指定時は追加で `status-stack.sh --include-proxy` を実行してproxyを含む稼働状況を確認します。`--skip-build` と `--skip-stack-check` を付けると、イメージ再ビルドやpost-update確認を個別に省略できます。`BACKUP_AND_CHECK` / `BUILD_IMAGES` / `INSTALL_UNITS` / `CHECK_STACK` / `STATUS_STACK` / `SYSTEMCTL` / `PODMAN` を環境変数で差し替えると、ローカル検証や運用フローの置き換えがしやすくなります。

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
