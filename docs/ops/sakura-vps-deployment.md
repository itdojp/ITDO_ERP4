# さくらVPS 導入 Runbook（本番準備レベル）

## 目的

ERP4 を 1 台のさくらVPSで小規模本番相当または長期試験稼働するための導入順序、チェックポイント、証跡を定義する。

この Runbook は入口であり、実際の Quadlet 操作は [sakura-vps-podman-trial](sakura-vps-podman-trial.md)、HTTPS reverse proxy は [sakura-vps-https-proxy](sakura-vps-https-proxy.md)、env は [sakura-vps-env-checklist](sakura-vps-env-checklist.md) を参照する。

## 全体フロー

```text
1. Google Cloud 事前設定
2. VPS 契約/OS/SSH/packet filter
3. OS hardening
4. Podman/Node.js/repo 配置
5. frontend build-time env
6. Quadlet unit install
7. runtime/proxy/maintenance env
8. build/migrate/start
9. HTTPS / OIDC / Drive 疎通
10. backup / monitoring / rollback 確認
11. Go/No-Go 記録
```

## 0. 導入前提

| 項目          | 推奨値                    | 備考                                            |
| ------------- | ------------------------- | ----------------------------------------------- |
| OS            | Ubuntu 24.04 LTS          | 22.04 からの流用時も手順差分を記録              |
| memory        | 2GB 以上推奨              | 1GB 以下は build / DB / ClamAV 等で余裕が少ない |
| user          | `deploy`                  | sudo 可能、rootless Podman 実行主体             |
| repo          | `/opt/itdo/ITDO_ERP4`     | scripts / Quadlet の例と揃える                  |
| runtime       | rootless Podman + Quadlet | user systemd で自動復帰                         |
| reverse proxy | Caddy                     | 既存テンプレートあり                            |
| auth          | `AUTH_MODE=jwt_bff`       | 公開環境で `AUTH_MODE=header` は使わない        |
| DB            | Podman PostgreSQL         | 単一VPSのSPOFであることを明示                   |

単一VPS構成の制約:

- VPS障害はアプリ/DB同時停止になる。
- PostgreSQLを同一ホストに置くため、backup/restore手順の実地確認が必須。
- 高可用性やDB分離が必要になったら別設計へ移行する。

## 1. Google Cloud 事前設定

先に [google-cloud-predeployment](google-cloud-predeployment.md) を完了する。

Go 条件:

- [ ] frontend/backend の FQDN が決まっている
- [ ] Google OIDC を使う場合、OAuth client と redirect URI が確定している
- [ ] Google Drive 添付を使う場合、Drive API / refresh token / folder ID が揃っている
- [ ] secret の保管先と転記方法が決まっている
- [ ] 本番secretを Issue / PR / docs に貼らない運用が合意されている

## 2. さくらVPS 契約/OS/SSH/packet filter

### 2-1. コントロールパネル作業

記録する値:

```text
VPS name:
Plan:
OS image:
Global IPv4:
Global IPv6:
Initial admin user:
SSH public key id/name:
Packet filter profile:
```

推奨:

- SSH公開鍵を事前登録し、鍵認証で初期ログインする。
- OS再インストールは破壊的操作として扱い、backup要否を確認してから実施する。
- packet filter は SSH と Web（80/443）だけを許可する。DB port は公開しない。
- Google OIDC を使う場合、raw IP ではなく DNS + HTTPS の準備を前提にする。

### 2-2. 初回ログイン

Ubuntu 標準OSでは初期ユーザーが `ubuntu` になる構成がある。実際のユーザー名はさくらVPS側のOS/インストール方式に従う。

```bash
ssh ubuntu@<VPS_IP>
```

`deploy` ユーザーを作る例:

```bash
sudo adduser deploy
sudo usermod -aG sudo deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo cp ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

以後は `deploy` で作業する。

## 3. OS hardening

### 3-1. 基本更新

```bash
sudo apt update
sudo apt -y upgrade
sudo apt -y install git curl jq make ca-certificates unzip ufw fail2ban unattended-upgrades
```

### 3-2. timezone / locale / time sync

```bash
timedatectl
sudo timedatectl set-timezone Asia/Tokyo
systemctl status systemd-timesyncd --no-pager || true
```

### 3-3. SSH

最低限の確認:

```bash
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication) '
```

推奨値:

```text
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
```

設定変更時は新しいSSHセッションでログイン確認が終わるまで既存セッションを閉じない。

### 3-4. firewall

Ubuntu側の例:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

さくらVPS packet filter と OS firewall の両方で許可が必要な場合がある。どちらか片方だけで通らない前提で確認する。

### 3-5. swap / disk

```bash
free -h
df -h
lsblk
```

メモリが少ない構成では build 時のOOMを避けるため、swap追加を検討する。swapを追加した場合はサイズ、ファイルパス、永続化方法を証跡に残す。

## 4. runtime 前提確認

詳細は [sakura-vps-podman-trial](sakura-vps-podman-trial.md) を参照する。

```bash
sudo apt -y install podman uidmap slirp4netns passt fuse-overlayfs
podman --version
node -v || true
```

Node.js は nvm または運用で選んだ方式で 20 LTS に固定する。

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 20
nvm alias default 20
```

rootless Podman:

```bash
grep '^deploy:' /etc/subuid /etc/subgid
sudo loginctl enable-linger deploy
loginctl show-user deploy | grep Linger
podman info
```

## 5. ソース配置/更新

初回:

```bash
sudo mkdir -p /opt/itdo
sudo chown deploy:deploy /opt/itdo
cd /opt/itdo
git clone https://github.com/itdojp/ITDO_ERP4.git
cd ITDO_ERP4
git checkout main
git pull --ff-only origin main
```

更新時:

```bash
cd /opt/itdo/ITDO_ERP4
git fetch origin main
git checkout main
git pull --ff-only origin main
```

証跡:

```bash
git rev-parse HEAD
git status --short --branch
```

## 6. build-time env

`deploy/quadlet/env/erp4-frontend-build.env` を用意する。

```bash
cp deploy/quadlet/env/erp4-frontend-build.env.example deploy/quadlet/env/erp4-frontend-build.env
chmod 600 deploy/quadlet/env/erp4-frontend-build.env
vi deploy/quadlet/env/erp4-frontend-build.env
```

最低限:

```dotenv
VITE_API_BASE=https://api.example.com
VITE_ENABLE_SW=true
```

Google OIDC の backend redirect フローだけを使う場合、`VITE_GOOGLE_CLIENT_ID` は不要。frontend が Google Identity Services を直接使う場合だけ設定する。

## 7. Quadlet unit / runtime env

```bash
./scripts/quadlet/check-env.sh --skip-runtime --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env
./scripts/quadlet/build-images.sh
./scripts/quadlet/install-user-units.sh
```

runtime env は `~/.config/containers/systemd/` 配下で管理する。

重要:

- env file は `chmod 600` を基本にする。
- `erp4-backend.env` に secret が入るため、backup/転送先も secret として扱う。
- `DATABASE_URL` の host は Podman network の `erp4-postgres` を使う。
- `ALLOWED_ORIGINS` は frontend の公開 origin のみに絞る。
- `AUTH_SESSION_COOKIE_SECURE=true` は HTTPS 公開時に必須。

確認:

```bash
./scripts/quadlet/check-env.sh
./scripts/quadlet/check-proxy.sh
```

## 8. 起動/疎通

proxyなしの内部確認:

```bash
./scripts/quadlet/start-stack.sh
./scripts/quadlet/check-trial-readiness.sh
```

HTTPS proxy込み:

```bash
./scripts/quadlet/start-stack.sh --include-proxy
./scripts/quadlet/check-trial-readiness.sh --include-proxy --resolve-ip <VPS_IP>
```

DNS反映後:

```bash
./scripts/quadlet/check-https.sh
curl -fsS https://api.example.com/healthz
curl -I https://app.example.com/
```

Google OIDC / Drive を使う場合:

- `/auth/google/start` から Google 認証へ遷移する。
- callback後にERP4へ戻る。
- `scripts/check-chat-gdrive.ts` の read/write が成功する。
- 失敗時は [google-cloud-predeployment](google-cloud-predeployment.md) のトラブルシュートへ戻る。

## 9. backup / restore / rollback

導入当日に最低限確認する。

```bash
systemctl --user enable --now erp4-config-backup.timer
systemctl --user enable --now erp4-db-backup.timer
systemctl --user list-timers 'erp4-*'
./scripts/quadlet/run-maintenance-now.sh --include-units
```

DB restore の詳細は [quadlet-db-backup-restore](quadlet-db-backup-restore.md) と [backup-restore](backup-restore.md) を参照する。

更新時のrollback候補:

- 前回 commit に戻す。
- 前回 image を再build/再起動する。
- Quadlet config backup を `restore-latest.sh` で戻す。
- DB migrationを伴う場合は、restore rehearsal 済みのbackupから戻せることを確認してから実行する。

破壊的操作:

- `scripts/podman-poc.sh reset` は試験DB初期化を伴う。導入済みVPSでは通常使わない。
- OS再インストールは全データ消去を伴う。backup/restore可否を確認してから実施する。

## 10. 監視/障害対応

最低限の確認:

```bash
./scripts/quadlet/status-stack.sh --include-proxy
./scripts/quadlet/logs-stack.sh --include-proxy --lines 100
journalctl --user -u erp4-backend.service -n 100 --no-pager
journalctl --user -u erp4-caddy.service -n 100 --no-pager
```

関連Runbook:

- [observability](observability.md)
- [alerting](alerting.md)
- [incident-response](incident-response.md)
- [slo](slo.md)

## 11. Go/No-Go 記録

導入完了時は、以下を Issue または `docs/test-results/` に残す。

```text
Date:
Operator:
VPS name/IP:
Domain:
Commit SHA:
Google Cloud project:
OIDC enabled: yes/no
Drive enabled: yes/no
check-env: pass/fail
check-proxy: pass/fail/n/a
check-trial-readiness: pass/fail
check-https: pass/fail/n/a
backup timer: enabled/disabled
DB backup timer: enabled/disabled
Rollback plan confirmed: yes/no
Open risks:
Go/No-Go:
```

Go 条件:

- health/readiness が成功している。
- frontend が公開URLで応答する。
- HTTPS証明書が有効である。
- OIDC/Driveを使う場合は各疎通確認が成功している。
- backup取得先と復元手順が確認済みである。
- secret がIssue/PR/docs/logへ漏れていない。

No-Go 条件:

- `AUTH_MODE=header` でインターネット公開しようとしている。
- DB port を外部公開している。
- `ALLOWED_ORIGINS` が過大である。
- restore手順が未確認のままデータを投入しようとしている。
- secret の保管先/ローテーション担当が未定である。

## 関連 Runbook

- Google Cloud 事前設定: [google-cloud-predeployment](google-cloud-predeployment.md)
- Quadlet 詳細手順: [sakura-vps-podman-trial](sakura-vps-podman-trial.md)
- env チェックリスト: [sakura-vps-env-checklist](sakura-vps-env-checklist.md)
- HTTPS reverse proxy: [sakura-vps-https-proxy](sakura-vps-https-proxy.md)
- 試験稼働 Go/No-Go: [sakura-vps-trial-checklist](sakura-vps-trial-checklist.md)
- Secrets/アクセス権限: [secrets-and-access](secrets-and-access.md)
- Backup/restore: [backup-restore](backup-restore.md)
- Quadlet DB backup/restore: [quadlet-db-backup-restore](quadlet-db-backup-restore.md)

## 参考（2026-05-10 確認）

- さくらVPS OS再インストール: <https://manual.sakura.ad.jp/vps/os-reinstall/index.html>
- さくらVPS SSH公開鍵: <https://manual.sakura.ad.jp/vps/controlpanel/ssh-keygen.html>
- さくらVPS パケットフィルター: <https://manual.sakura.ad.jp/vps/network/packetfilter.html>
- さくらVPS 管理ユーザーログイン: <https://manual.sakura.ad.jp/vps/support/info/administrative-userl-login.html>
- Google Cloud 事前設定: [google-cloud-predeployment](google-cloud-predeployment.md)
