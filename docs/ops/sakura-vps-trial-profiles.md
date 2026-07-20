# さくらVPS 試用プロファイル

## 目的

#1900 のアーキテクチャ改善を、本番用 S3/KMS、外部製品連携、production OAuth credential の確定を待たずに安全に回帰確認するため、さくらVPS 試用を次の 2 プロファイルに分離する。

| profile         | 目的                                                              | 公開               | 認証                                                   | Proxy          | 外部送信                              |
| --------------- | ----------------------------------------------------------------- | ------------------ | ------------------------------------------------------ | -------------- | ------------------------------------- |
| `private-smoke` | 非公開 rootless Podman / Quadlet stack の起動・再起動・probe      | しない             | 認証操作は対象外。必要時のみ非公開・開発用 header auth | Caddy 起動禁止 | `MAIL_TRANSPORT=stub`、local provider |
| `https-trial`   | trial 専用 FQDN + HTTPS + trial OAuth client による利用者向け試用 | trial 接続元に限定 | `AUTH_MODE=jwt_bff`                                    | Caddy 必須     | 既定は stub/local provider            |

本プロファイルは Production Readiness #1875 の本番 Go/No-Go を代替しない。実 S3/KMS、対象環境証跡、外部 CSV 現物は #1875 側で扱う。

## `private-smoke`

### 必須設定

| 区分         | 要件                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| backend env  | `SAKURA_VPS_PROFILE=private-smoke`                                                                               |
| auth         | `NODE_ENV=production` + `AUTH_MODE=header` を禁止。`AUTH_ALLOW_HEADER_FALLBACK_IN_PROD=true` も禁止              |
| network      | `erp4-backend.container` / `erp4-frontend.container` / `erp4-postgres.container` に `PublishPort=` を置かない    |
| proxy        | `erp4-caddy.container` / `erp4-caddy.env` / `erp4-caddy.Caddyfile` を配置しない                                  |
| mail/storage | `MAIL_TRANSPORT=stub`、`PDF_PROVIDER=local`、`EVIDENCE_ARCHIVE_PROVIDER=local`、`CHAT_ATTACHMENT_PROVIDER=local` |

Google OIDC の実 secret は不要。認証 UI / OAuth callback は smoke 対象外とする。

### 標準コマンド

```bash
ERP4_IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
ERP4_IMAGE_TAG="$ERP4_IMAGE_TAG" ./scripts/quadlet/install-user-units.sh --profile private-smoke
cp deploy/quadlet/env/erp4-backend.private-smoke.env.example ~/.config/containers/systemd/erp4-backend.env
cp deploy/quadlet/env/erp4-frontend-build.private-smoke.env.example deploy/quadlet/env/erp4-frontend-build.env

./scripts/quadlet/check-env.sh \
  --profile private-smoke \
  --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env

./scripts/quadlet/start-stack.sh \
  --profile private-smoke

./scripts/quadlet/check-trial-readiness.sh \
  --profile private-smoke
```

probe は `podman exec` または明示的な SSH tunnel 内で実施する。Caddy や public port を private-smoke 成立のために有効化しない。
`--profile private-smoke` の installer は private-smoke 用 PostgreSQL overlay を選択し、Caddy unit/env/config を配置しない。対象ディレクトリに既存の Caddy 設定がある場合は無断削除せず停止するため、事前に backup を取得して明示的に proxy 設定を除去する。

## `https-trial`

### 必須設定

| 区分         | 要件                                                                |
| ------------ | ------------------------------------------------------------------- |
| backend env  | `SAKURA_VPS_PROFILE=https-trial`                                    |
| auth         | `NODE_ENV=production`、`AUTH_MODE=jwt_bff`、trial 専用 OAuth client |
| HTTPS        | `AUTH_FRONTEND_ORIGIN` と `GOOGLE_OIDC_REDIRECT_URI` は `https://`  |
| cookie       | `AUTH_SESSION_COOKIE_SECURE=true`                                   |
| proxy        | Caddy を配置し、80/443 を公開                                       |
| frontend     | `VITE_API_BASE=https://...`                                         |
| mail/storage | `MAIL_TRANSPORT=stub`、local provider を既定                        |

production domain、production OAuth client、production S3 は流用しない。Sakura packet filter / UFW などで接続元を trial 利用者に限定する。

### 標準コマンド

```bash
ERP4_IMAGE_TAG="$(git rev-parse --short=12 HEAD)"
ERP4_IMAGE_TAG="$ERP4_IMAGE_TAG" ./scripts/quadlet/install-user-units.sh --profile https-trial
cp deploy/quadlet/env/erp4-backend.https-trial.env.example ~/.config/containers/systemd/erp4-backend.env
cp deploy/quadlet/env/erp4-frontend-build.https-trial.env.example deploy/quadlet/env/erp4-frontend-build.env
cp deploy/quadlet/env/erp4-caddy.env.example ~/.config/containers/systemd/erp4-caddy.env

./scripts/quadlet/check-env.sh \
  --profile https-trial \
  --frontend-build-env deploy/quadlet/env/erp4-frontend-build.env

./scripts/quadlet/start-stack.sh \
  --profile https-trial \
  --include-proxy

./scripts/quadlet/check-trial-readiness.sh \
  --profile https-trial \
  --include-proxy
```

## 機械検査

profile-aware checker は以下を検出して非 0 終了する。

- `private-smoke` で Caddy / proxy file が存在する
- `private-smoke` で backend / frontend / PostgreSQL が host publish されている
- `private-smoke` で production header auth または production header fallback が有効
- `https-trial` で HTTP origin / redirect / frontend API base を使っている
- `https-trial` で secure cookie が無効
- `https-trial` で Google OIDC / JWT BFF 必須値が不足

ローカル regression test:

```bash
make sakura-vps-profile-check
make ops-quality
```

テストは実 secret 値を使わず、secret-like 値がエラー出力へ漏れないことも確認する。
