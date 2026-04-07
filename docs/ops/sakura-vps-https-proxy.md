# さくらVPS + Podman + Quadlet + HTTPS reverse proxy

## 目的

`docs/ops/sakura-vps-podman-trial.md` の backend / frontend Quadlet stack の前段に、Caddy を Quadlet で常駐させて HTTPS を終端するための手順です。

前提は 2026-04-02 時点の以下です。

- Podman rootless + Quadlet
- `deploy/quadlet/erp4-backend.container`
- `deploy/quadlet/erp4-frontend.container`
- `AUTH_MODE=jwt_bff`

ホスト側の前提は `check-host-prereqs.sh` で先に確認できます。

```bash
./scripts/quadlet/check-host-prereqs.sh
./scripts/quadlet/check-host-prereqs.sh --skip-port-check
```

このチェックは以下を検証します。
- `loginctl show-user $(id -un)` の linger 有効化
- `net.ipv4.ip_unprivileged_port_start` が 80 以下
- `podman` / `systemctl` / `loginctl` の存在
- 必要に応じて `ss` または `netstat` で `80/443` の利用状況

## 前提条件

- `app.example.com` と `api.example.com` が VPS のグローバル IP を向いていること
- Ubuntu 側の firewall / さくらVPS パケットフィルタで `80/tcp` と `443/tcp` を許可すること
- backend / frontend の Quadlet stack が先に起動済みであること

rootless Podman のまま `80/443` を bind する場合は、Linux 側で unprivileged port を開放します。

```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/90-itdo-rootless-ports.conf
sudo sysctl --system
```

`80/443` を rootless で開けない運用にする場合は、この unit をそのまま使わず、rootful な reverse proxy かホストの nginx / Caddy を前段に置いてください。

## 1. frontend / backend 側の origin を HTTPS 前提へ揃える

`%h/.config/containers/systemd/erp4-backend.env`:

```dotenv
ALLOWED_ORIGINS=https://app.example.com
AUTH_FRONTEND_ORIGIN=https://app.example.com
GOOGLE_OIDC_REDIRECT_URI=https://api.example.com/auth/google/callback
AUTH_SESSION_COOKIE_SECURE=true
```

`%h/.config/containers/systemd/erp4-frontend-build.env`:

```dotenv
VITE_API_BASE=https://api.example.com
```

## 2. reverse proxy 用の env / Caddyfile を配置する

`scripts/quadlet/install-user-units.sh` 実行後、以下が `%h/.config/containers/systemd/` に配置されます。

- `erp4-caddy.env`
- `erp4-caddy.Caddyfile`

最小設定例:

`erp4-caddy.env`
```dotenv
APP_DOMAIN=app.example.com
API_DOMAIN=api.example.com
ACME_EMAIL=ops@example.com
```

`erp4-caddy.Caddyfile`
```caddyfile
{
	email {$ACME_EMAIL}
	servers {
		trusted_proxies static private_ranges
	}
}

{$APP_DOMAIN} {
	encode zstd gzip
	reverse_proxy http://erp4-frontend:8080
}

{$API_DOMAIN} {
	encode zstd gzip
	reverse_proxy http://erp4-backend:3001 {
		header_up X-Forwarded-Proto https
	}
}
```

frontend unit は `deploy/quadlet/erp4-frontend.container` で `erp4.network` へ参加させる前提です。これにより Caddy から `erp4-frontend:8080` を直接解決できます。

## 3. 起動

backend / frontend の env を更新した後に build / reload します。

```bash
cd /opt/itdo/ITDO_ERP4
./scripts/quadlet/check-env.sh
./scripts/quadlet/check-proxy.sh
./scripts/quadlet/build-images.sh
systemctl --user daemon-reload
systemctl --user restart erp4-migrate.service
systemctl --user restart erp4-backend.service
systemctl --user restart erp4-frontend.service
systemctl --user enable --now erp4-caddy.service
```

## 4. proxy 設定だけを再読込する

Caddyfile または `erp4-caddy.env` だけを更新した場合は、stack 全体を再起動せずに proxy のみ再検証・再読込できます。

```bash
./scripts/quadlet/reload-proxy.sh
```

追加の確認を省略したい場合は以下を使います。

```bash
./scripts/quadlet/reload-proxy.sh --skip-status
./scripts/quadlet/reload-proxy.sh --skip-runtime
./scripts/quadlet/reload-proxy.sh --skip-proxy-check
```

`--skip-runtime` は `podman` を使う runtime validate を省略します。`--skip-proxy-check` を使う場合でも、変更後に `./scripts/quadlet/check-proxy.sh` を個別実行して設定妥当性を確認してください。

## 5. 確認

公開ドメインでの確認は `check-https.sh` を基準にします。DNS 切替前は `--resolve-ip <vps_global_ip>` で仮確認し、DNS 反映後は `--resolve-ip` なしで再実行して、実際の公開経路で到達できることを確認します。可能であれば VPS 外のネットワークからも同じコマンドを実行し、ローカル DNS キャッシュやホスト内ルーティングに依存しないことを確認してください。

```bash
./scripts/quadlet/check-proxy.sh
./scripts/quadlet/check-https.sh
./scripts/quadlet/check-https.sh --resolve-ip <vps_global_ip>
systemctl --user status erp4-caddy.service --no-pager
curl -I https://app.example.com
curl -fsS https://api.example.com/healthz
podman logs erp4-caddy
```

`check-https.sh` は `erp4-caddy.env` から `APP_DOMAIN` / `API_DOMAIN` を読み取り、`https://<APP_DOMAIN>/` と `https://<API_DOMAIN>/healthz` を probe します。DNS 切替前に VPS 上で仮確認したい場合は `--resolve-ip <vps_global_ip>` を付け、名前解決を一時的に固定してください。`--app-path` / `--api-path` に先頭 `/` が無い場合は自動補正します。`--resolve-ip` は IPv4/IPv6 のどちらも扱え、IPv6 は括弧無しで渡しても自動的に bracket します。証明書更新直後などで chain の確認を一時的に緩めたい場合だけ `--insecure` を使います。

Google OIDC を使う場合は、Google Cloud Console 側の redirect URI も `https://api.example.com/auth/google/callback` へ揃えます。Google 側の詳細手順は [google-oidc-google-cloud-console](google-oidc-google-cloud-console.md) を参照してください。

## 6. 障害切り分け

- `erp4-caddy.service` が起動しない
  - `80/443` を別プロセスが占有していないか確認
  - `net.ipv4.ip_unprivileged_port_start=80` が反映済みか確認
  - `podman logs erp4-caddy` と `journalctl --user -u erp4-caddy.service -n 100 --no-pager` を確認
- ACME 証明書が取得できない
  - DNS が VPS を向いているか確認
  - `80/tcp` と `443/tcp` が外部到達可能か確認
  - 既に別の reverse proxy が `80/443` を listen していないか確認
- backend だけ 502 になる
  - `erp4-backend.service` の health/readiness と `ALLOWED_ORIGINS` / `AUTH_FRONTEND_ORIGIN` を確認
  - `X-Forwarded-Proto=https` が backend へ渡っているか確認
