# 導入自動化スクリプト Runbook

## 目的

さくらVPS導入と Google Cloud / Google Drive 事前確認を、手作業だけでなく再実行可能な補助スクリプトとして実行する。各スクリプトは安全側の既定値を採用し、`--check` / `--dry-run` と `--apply` を分離する。

## スクリプト一覧

| スクリプト                            | 目的                                                                                             | 既定の安全性                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `scripts/ops/sakura-vps-preflight.sh` | VPSのOS/arch/必須コマンド/メモリ/ディスク/port（80/443/3001/4173/8080/55432）/rootless前提を診断 | `--check` のみ。読み取り専用                                         |
| `scripts/ops/sakura-vps-bootstrap.sh` | apt package、repo配置先、backup dir、linger、rootless low port設定を補助                         | 既定は `--check`。変更は `--apply` 明示時のみ                        |
| `scripts/ops/sakura-vps-deploy.sh`    | git更新、`npm ci`、Quadlet build/install/start/updateを補助                                      | 既定は `--check`。実行は `--apply` 明示時のみ                        |
| `scripts/ops/sakura-vps-verify.sh`    | Quadlet env/stack/HTTPS/Drive疎通を証跡化                                                        | 読み取り中心。Drive write test は `--gdrive-mode write` 明示時のみ   |
| `scripts/ops/gcp-preflight.sh`        | gcloud account/project/API/billing/secret metadata/WIFを確認                                     | 既定は `--check`。API有効化は `--apply --confirm-project` 明示時のみ |
| `scripts/ops/gcp-drive-check.sh`      | 既存 `check-chat-gdrive.ts` / `provision-chat-gdrive-folder.ts` の安全な wrapper                 | secret値は表示しない。write test は `--mode write` 明示時のみ        |

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

### 4. verify / 証跡化

```bash
./scripts/ops/sakura-vps-verify.sh --check \
  --include-proxy \
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

初回 folder 作成:

```bash
./scripts/ops/gcp-drive-check.sh \
  --env-file ./.env.gdrive \
  --provision-folder \
  --mode read
```

read test:

```bash
./scripts/ops/gcp-drive-check.sh --env-file ./.env.gdrive --mode read
```

write test:

```bash
./scripts/ops/gcp-drive-check.sh --env-file ./.env.gdrive --mode write
```

`.env.gdrive` には以下の値を置く。wrapper はこのうち許可された key だけを読み取り、任意の shell command としては実行しない。file mode は `chmod 600` を推奨する。

```dotenv
CHAT_ATTACHMENT_GDRIVE_CLIENT_ID=...
CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET=...
CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN=...
CHAT_ATTACHMENT_GDRIVE_FOLDER_ID=...
```

## 安全設計

- destructive command（DB reset、OS再インストール、secret destroy）は含めない。
- `--apply` なしで Google Cloud API 有効化やVPS変更は行わない。
- secret値、refresh token、client secret、DB password は stdout/stderr へ出さない。
- env file の file mode が緩い場合は warning を出す。
- Drive write test は明示フラグ時のみ実行する。
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
- destructive command guard（例: `rm -rf`、`git reset --hard`、`git clean -fd`、`podman volume rm`、Secret Manager の secret value access/delete）
- `docs/ops/examples/*.env.example` の必須キーと、OAuth client secret / token / webhook など実secretらしい値の混入検出（ログは path:line のみ）

VPSホスト依存の `--check` は、CI runner に Podman / systemd / Quadlet 実体がない場合に controlled failure として扱う。これは「構文や引数処理が壊れていないこと」と「ホスト依存の不足が明示的な診断として出ること」をCIで検証するためであり、本番適用前の実ホスト preflight / verify を代替しない。

## 関連Runbook

- [google-cloud-predeployment](google-cloud-predeployment.md)
- [sakura-vps-deployment](sakura-vps-deployment.md)
- [sakura-vps-podman-trial](sakura-vps-podman-trial.md)
- [sakura-vps-https-proxy](sakura-vps-https-proxy.md)
- [secrets-and-access](secrets-and-access.md)
