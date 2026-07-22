# 導入自動化スクリプト Runbook

## 目的

さくらVPS導入と Google Cloud / Google Drive 事前確認を、手作業だけでなく再実行可能な補助スクリプトとして実行する。各スクリプトは安全側の既定値を採用し、`--check` / `--dry-run` と `--apply` を分離する。

## スクリプト一覧

| スクリプト                            | 目的                                                                                             | 既定の安全性                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `scripts/ops/sakura-vps-preflight.sh` | VPSのOS/arch/必須コマンド/メモリ/ディスク/port（80/443/3001/4173/8080/55432）/rootless前提を診断 | `--check` のみ。読み取り専用                                                                               |
| `scripts/ops/sakura-vps-bootstrap.sh` | apt package、repo配置先、backup dir、linger、rootless low port設定を補助                         | 既定は `--check`。変更は `--apply` 明示時のみ                                                              |
| `scripts/ops/sakura-vps-deploy.sh`    | git更新、`npm ci`、Quadlet build/install/start/updateを補助                                      | 既定は `--check`。実行は `--apply` 明示時のみ                                                              |
| `scripts/ops/sakura-vps-verify.sh`    | Quadlet env/stack/HTTPS/Drive疎通を証跡化                                                        | 読み取り中心。Drive write test は `--gdrive-mode write` 明示時のみ                                         |
| `scripts/ops/gcp-preflight.sh`        | gcloud account/project/API/billing/secret metadata/WIFを確認                                     | 既定は `--check`。API有効化は `--apply --confirm-project` 明示時のみ                                       |
| `scripts/ops/gcp-drive-check.sh`      | context別 Google Drive folder provision / read-write operator preflightを行う標準wrapper         | credential / folder ID / Drive ID は表示しない。`--target <context>`、write testは`--mode write`明示時のみ |

## さくらVPS: 推奨実行順

### 1. 事前診断

```bash
./scripts/ops/sakura-vps-preflight.sh --check
```

`--strict` を付けると、port 使用中などの警告も失敗として扱う。

```bash
./scripts/ops/sakura-vps-preflight.sh --check --strict
```

### 2. bootstrap dry-run

```bash
./scripts/ops/sakura-vps-bootstrap.sh --dry-run \
  --deploy-user deploy \
  --repo-dir /opt/itdo/ITDO_ERP4
```

実行内容を確認してから `--apply` に切り替える。

```bash
./scripts/ops/sakura-vps-bootstrap.sh --apply \
  --deploy-user deploy \
  --repo-dir /opt/itdo/ITDO_ERP4
```

Caddy を rootless Podman で 80/443 に bind する場合のみ、別途承認して low port 設定を入れる。

```bash
./scripts/ops/sakura-vps-bootstrap.sh --apply \
  --deploy-user deploy \
  --repo-dir /opt/itdo/ITDO_ERP4 \
  --set-unprivileged-port-start
```

### 3. deploy check / dry-run / apply

本番値を編集したあと、まず読み取り専用で検証する。

```bash
./scripts/ops/sakura-vps-deploy.sh --check \
  --repo-dir /opt/itdo/ITDO_ERP4 \
  --include-proxy
```

変更内容を確認する。

```bash
./scripts/ops/sakura-vps-deploy.sh --dry-run \
  --repo-dir /opt/itdo/ITDO_ERP4 \
  --branch main \
  --include-proxy
```

初回起動:

```bash
./scripts/ops/sakura-vps-deploy.sh --apply \
  --repo-dir /opt/itdo/ITDO_ERP4 \
  --branch main \
  --include-proxy
```

既存稼働中の更新では `--update-existing` を付ける。

```bash
./scripts/ops/sakura-vps-deploy.sh --apply \
  --repo-dir /opt/itdo/ITDO_ERP4 \
  --branch main \
  --include-proxy \
  --update-existing
```

非公開試験ではprofileを全フェーズへ固定し、`--include-proxy`を付けない。

```bash
./scripts/ops/sakura-vps-deploy.sh --check \
  --profile private-smoke \
  --repo-dir /opt/itdo/ITDO_ERP4

./scripts/ops/sakura-vps-deploy.sh --apply \
  --profile private-smoke \
  --repo-dir /opt/itdo/ITDO_ERP4 \
  --branch main
```

`private-smoke` installerはCaddyを配置せず、非公開PostgreSQL overlayを選択する。対象ディレクトリに既存のCaddy artifactがある場合、installer自身がエラー終了し、稼働中のCaddy serviceは停止しない。profile切り替え前に設定をbackupし、`./scripts/quadlet/disable-stack.sh --include-proxy` でproxyを明示停止・無効化してから、Runbookに従って既存artifactを明示的に退避または削除する。

### 4. verify / 証跡化

```bash
./scripts/ops/sakura-vps-verify.sh --check \
  --include-proxy \
  --markdown-summary docs/test-results/sakura-vps-verify-YYYY-MM-DD.md
```

非公開試験の検証:

```bash
./scripts/ops/sakura-vps-verify.sh --check \
  --profile private-smoke \
  --markdown-summary docs/test-results/sakura-vps-verify-YYYY-MM-DD.md
```

DNS反映前に VPS IP へ解決させる場合:

```bash
./scripts/ops/sakura-vps-verify.sh --check \
  --include-proxy \
  --resolve-ip <VPS_IP>
```

Google Drive 連携を採用している場合は read test を加える。

```bash
./scripts/ops/sakura-vps-verify.sh --check \
  --include-proxy \
  --gdrive-mode read \
  --markdown-summary docs/test-results/sakura-vps-verify-YYYY-MM-DD.md
```

`--gdrive-mode write` はテストファイルの作成/削除を伴うため、導入当日の Go/No-Go 判断時などに限定する。

## Google Cloud: 推奨実行順

### 1. preflight check

```bash
./scripts/ops/gcp-preflight.sh --check \
  --project erp4-prod \
  --secret erp4-google-oidc-client-secret \
  --secret erp4-chat-gdrive-refresh-token \
  --markdown-summary docs/test-results/gcp-preflight-YYYY-MM-DD.md
```

このコマンドは secret の値を読み取らず、secret metadata と version 状態のみを確認する。

### 2. API有効化を自動化する場合

`--apply` は不足APIの有効化だけを行う。project誤りを防ぐため、`--confirm-project` が `--project` と一致しない場合は停止する。

```bash
./scripts/ops/gcp-preflight.sh --apply \
  --project erp4-prod \
  --confirm-project erp4-prod
```

### 3. WIF / service account確認

```bash
./scripts/ops/gcp-preflight.sh --check \
  --project erp4-prod \
  --wif-pool github-actions \
  --wif-provider github \
  --wif-service-account erp4-deploy@erp4-prod.iam.gserviceaccount.com
```

### 4. Drive folder / read-write check

#1977ではPDF / Evidence archive / Report用のcontext別folderとruntime providerを追加しています。productionはShared Driveの専用subfolderを推奨しますが、Shared Drive直下またはMy Driveの専用folderも構成できます。`ERP4_GDRIVE_SHARED_DRIVE_ID`はShared Drive ID、各`*_GDRIVE_FOLDER_ID`は実際の保存先folder IDとして分離します。

wrapper は compiled backend CLI を使います。未buildのcheckoutでは、repository標準手順で backend dependencies / Prisma Client を準備した後、先に `npm run build --prefix packages/backend` を実行します。

初回 folder 作成では、folder ID の保護された出力先を必ず指定する:

```bash
install -d -m 700 .codex-local/secure
umask 077
touch .codex-local/secure/gdrive.env
chmod 600 .codex-local/secure/gdrive.env
```

`.codex-local/secure/gdrive.env` に credential と必要に応じて Shared Drive ID を editor / secret injection で設定し、値を画面表示しない。その後に provision を実行する。

```bash
./scripts/ops/gcp-drive-check.sh \
  --env-file .codex-local/secure/gdrive.env \
  --provision-folder \
  --folder-id-output-file .codex-local/secure/chat-gdrive-folder.env \
  --mode read
```

`--folder-id-output-file` は `--provision-folder` と同時に必須です。既存ファイルは上書きせず、新規ファイルを mode `0600` で作成します。folder ID を stdout や Markdown 証跡へ出さず、承認済みの secret 保管先/runtime env（上記の保護済み env file を含む）へ画面出力なしで転記します。単独の read / write を実行する前に、この転記を完了します。

remote create の結果が不明で出力に `CREATE_STARTED` が残った場合は、そのファイルを削除せず次の read-only reconciliation を実行する。一致が1件の場合だけ `COMPLETE` へ更新し、0件または複数件ではremote createを繰り返さず停止する。

```bash
./scripts/ops/gcp-drive-check.sh \
  --env-file .codex-local/secure/gdrive.env \
  --reconcile-provision \
  --folder-id-output-file .codex-local/secure/chat-gdrive-folder.env \
  --mode read
```

read test:

```bash
./scripts/ops/gcp-drive-check.sh --env-file .codex-local/secure/gdrive.env --mode read
```

write test:

```bash
./scripts/ops/gcp-drive-check.sh --env-file .codex-local/secure/gdrive.env --mode write
```

`.codex-local/secure/gdrive.env` には以下の値を置く。wrapper はこのうち許可された key だけを読み取り、任意の shell command としては実行しない。file mode `0600`、current user 所有、通常 file（symlink 不可）を必須とし、満たさない場合は処理を開始しない。

```dotenv
# Values are placeholders. Inject actual values from the approved secret store.
ERP4_GDRIVE_CLIENT_ID=<oauth-client-id>
ERP4_GDRIVE_CLIENT_SECRET=<oauth-client-secret>
ERP4_GDRIVE_REFRESH_TOKEN=<oauth-refresh-token>
# Set only for Shared Drive. Keep the Drive ID separate from the folder ID.
ERP4_GDRIVE_SHARED_DRIVE_ID=<optional-shared-drive-id>
CHAT_ATTACHMENT_GDRIVE_FOLDER_ID=<chat-storage-folder-id>
PDF_GDRIVE_FOLDER_ID=<pdf-storage-folder-id>
EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID=<evidence-storage-folder-id>
REPORT_GDRIVE_FOLDER_ID=<report-storage-folder-id>
ERP4_GDRIVE_TIMEOUT_MS=30000
ERP4_GDRIVE_MAX_RETRIES=3
ERP4_GDRIVE_RETRY_BASE_DELAY_MS=250
ERP4_GDRIVE_RESUMABLE_UPLOAD_THRESHOLD_BYTES=5242880
```

新規設定は共通 credential キー `ERP4_GDRIVE_CLIENT_ID` / `ERP4_GDRIVE_CLIENT_SECRET` / `ERP4_GDRIVE_REFRESH_TOKEN` を完全なsetで使います。共通キーを1つでも設定した場合は旧キーとのfield単位の混在を拒否し、共通setがすべて未設定の場合だけ完全な旧 `CHAT_ATTACHMENT_GDRIVE_*` setへfallbackします。両方が完全な場合は共通setが優先されます。wrapper は旧キーの使用を値なしで警告します。

実 Google Drive に対する read / write は operator preflight です。fake API を使う unit test は API parameter・再試行・エラー処理の検証であり、実ユーザ membership / scope / folder 権限の確認を代替しません。production の各`*_PROVIDER=gdrive`切り替えは、対象contextごとのread/write結果とcopy-only照合を確認する#1981の人間承認対象です。

## 安全設計

- destructive command（DB reset、OS再インストール、secret destroy）は含めない。
- `--apply` なしで Google Cloud API 有効化やVPS変更は行わない。
- secret値、refresh token、client secret、DB password は stdout/stderr へ出さない。
- Google Drive の folder ID / Drive ID は stdout、Issue、PR、Markdown 証跡へ出さない。
- env file が mode `0600`、current user 所有、通常 file（symlink 不可）でなければ fail closed とする。
- Drive write test は明示フラグ時のみ実行する。
- `files.create` の結果が不明な場合は重複防止のため fresh create をアプリ再試行しない。read / stat / trash は retryable な失敗だけを設定上限まで再試行し、削除は既定で trash とする。
- Google Drive 呼び出しは `supportsAllDrives` を使い、`includeItemsFromAllDrives` / `corpora=drive` / `driveId` は list に限定する。5MiB 以上の upload は Drive API resumable session を使い、create 時は `ignoreDefaultVisibility=true` とする。
- Drive URLや直接共有権限を返さず、domain-wide delegation を追加しない。preflight は folder permissions を全 page 検査し、domain / anyone / group / 複数 user がある保存先を No-Go とする。
- rootless 80/443 用 sysctl は `--set-unprivileged-port-start` 明示時のみ変更する。

## 品質チェック

PR作成前に最低限以下を実行する。CI では既存の `CI / lint` job 内で同じチェックを実行し、backend 側の `npm install` 済み環境を再利用して所要時間の増加を抑える。

```bash
make ops-quality
```

個別に確認する場合は以下を実行する。

```bash
./scripts/check-ops-docs.sh
./scripts/check-ops-scripts.sh
```

`check-ops-docs.sh` は導入Runbook系 Markdown / JSON examples に対して Prettier と相対リンク存在確認を行う。外部リンクは既存の `Link Check / lychee` job が検証する。

`check-ops-scripts.sh` は以下を blocking gate とする。

- `scripts/ops/*.sh` と `scripts/ops/lib/*.sh` の `bash -n`
- `shellcheck` がある環境での shellcheck warning 以上（未導入環境では skip を明示）
- 各 ops entrypoint の `--help`
- Google Cloud / Sakura VPS helper の dry-run / check smoke
- destructive or secret-exposing command guard（例: `rm -rf`、`git reset --hard`、`git clean -fd`、`podman volume rm`、Secret Manager の secret value access/delete）
- `docs/ops/examples/*.env.example` の必須キーと、OAuth client secret / token / webhook など実secretらしい値の混入検出（ログは path:line のみ）

VPSホスト依存の `--check` は、CI runner に Podman / systemd / Quadlet 実体がない場合に controlled failure として扱う。これは「構文や引数処理が壊れていないこと」と「ホスト依存の不足が明示的な診断として出ること」をCIで検証するためであり、本番適用前の実ホスト preflight / verify を代替しない。

## 関連Runbook

- [google-cloud-predeployment](google-cloud-predeployment.md)
- [sakura-vps-deployment](sakura-vps-deployment.md)
- [sakura-vps-podman-trial](sakura-vps-podman-trial.md)
- [sakura-vps-https-proxy](sakura-vps-https-proxy.md)
- [secrets-and-access](secrets-and-access.md)
