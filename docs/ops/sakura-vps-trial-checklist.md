# さくらVPS 試験稼働チェックリスト

## 目的
- さくらVPS 上の rootless Podman + Quadlet 構成について、試験稼働の Go/No-Go 判定を 1 回で再実施できる形にする。
- `sakura-vps-podman-trial.md` の詳細手順から、受入確認に必要な最小手順だけを抜き出す。

## 前提
- 作業ユーザーは `deploy` を想定する。
- リポジトリは `/opt/itdo/ITDO_ERP4` に配置済みで、`origin/main` と対象 PR の差分が反映済みであること。
- build-time 用の `deploy/quadlet/env/erp4-frontend-build.env` を準備済みであること。
- runtime 用の `erp4-postgres.env` / `erp4-backend.env` は `~/.config/containers/systemd/`（`QUADLET_TARGET_DIR` を変える場合はそのディレクトリ）に配置済み、または `install-user-units.sh` 実行後に編集可能なこと。
- proxy を使う場合の `erp4-caddy.env` / `erp4-caddy.Caddyfile` も `~/.config/containers/systemd/` 配下に配置済み、または `install-user-units.sh` 実行後に編集可能なこと。
- 公開ドメインを使う確認は、`erp4-caddy.service` を起動する場合だけ実施する。

## Go/No-Go 手順

### 1. host 前提確認
```bash
cd /opt/itdo/ITDO_ERP4
./scripts/quadlet/check-host-prereqs.sh
```

確認観点:
- `loginctl enable-linger`
- Podman / systemd / `sysctl`
- 80/443 の bind 可否 / 占有有無
- `subuid` / `subgid` はこのスクリプトでは検証しないため、別途手動確認する

### 2. build-time env 検証
```bash
./scripts/quadlet/check-env.sh --skip-runtime --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env
```

### 3. イメージ build
```bash
./scripts/quadlet/build-images.sh
```

最低限の確認:
- `localhost/erp4-backend:latest`
- `localhost/erp4-frontend:latest`

### 4. Quadlet unit 配置
```bash
./scripts/quadlet/install-user-units.sh
```

確認対象:
- `~/.config/containers/systemd/erp4-postgres.container`
- `~/.config/containers/systemd/erp4-backend.container`
- `~/.config/containers/systemd/erp4-frontend.container`
- 必要時:
  - `~/.config/containers/systemd/erp4-caddy.container`
  - `~/.config/containers/systemd/erp4-config-backup.timer`
  - `~/.config/containers/systemd/erp4-db-backup.timer`

### 5. runtime env / proxy 設定の編集と検証
`install-user-units.sh` 実行後に、`~/.config/containers/systemd/` 配下の runtime env と必要時の proxy 設定を編集してから検証する。

```bash
./scripts/quadlet/check-env.sh
```

公開ドメイン確認まで含める場合:
```bash
./scripts/quadlet/check-proxy.sh
```

### 6. stack 起動
通常:
```bash
./scripts/quadlet/start-stack.sh
```

proxy も起動する場合:
```bash
./scripts/quadlet/start-stack.sh --include-proxy
```

### 7. 受入確認
通常:
```bash
./scripts/quadlet/check-trial-readiness.sh
```

proxy / 公開ドメイン仮確認を含める場合:
```bash
./scripts/quadlet/check-trial-readiness.sh --include-proxy --resolve-ip <VPS_IP>
```

補足:
- `--resolve-ip` と `--insecure` は `--include-proxy` 指定時のみ使える。
- 既に DNS が切り替わっている場合は `--resolve-ip` を省略し、必要なら `check-https.sh` を単独実行する。

### 8. 稼働証跡の採取
```bash
./scripts/quadlet/status-stack.sh
./scripts/quadlet/logs-stack.sh --lines 100
systemctl --user list-timers 'erp4-*'
```

proxy を含める場合:
```bash
./scripts/quadlet/status-stack.sh --include-proxy
./scripts/quadlet/logs-stack.sh --include-proxy --lines 100
```

残すべき証跡:
- 実行日時
- 対象ホスト名 / VPS IP
- 参照 commit SHA
- `check-trial-readiness.sh` の結果
- `status-stack.sh` の結果
- 直近 100 行程度の `logs-stack.sh` 出力
- 必要時:
  - `check-https.sh` の結果
  - `systemctl --user list-timers` の結果

## Go 判定
- `check-trial-readiness.sh` が成功終了する
- `status-stack.sh` で `erp4-postgres.service`、`erp4-backend.service`、`erp4-frontend.service` が active
- backend の `/healthz` / `/readyz` が成功
- frontend の HTTP probe が成功
- proxy を含める場合、`check-https.sh` が成功

## No-Go 時の最小切り戻し
```bash
./scripts/quadlet/logs-stack.sh --lines 200
./scripts/quadlet/stop-stack.sh
```

proxy を含める場合:
```bash
./scripts/quadlet/logs-stack.sh --include-proxy --lines 200
./scripts/quadlet/stop-stack.sh --include-proxy
```

既存設定へ戻す必要がある場合:
```bash
./scripts/quadlet/rollback-latest.sh --skip-stack-check
```

設定だけ戻す場合:
```bash
./scripts/quadlet/restore-latest.sh --list
./scripts/quadlet/restore-latest.sh --overwrite
```

## 関連 Runbook
- 詳細手順: [sakura-vps-podman-trial](sakura-vps-podman-trial.md)
- HTTPS reverse proxy: [sakura-vps-https-proxy](sakura-vps-https-proxy.md)
- バックアップ/リストア: [backup-restore](backup-restore.md)
