# Google OIDC（Google Cloud Console 側）設定手順

## 目的
- ERP4 で `AUTH_MODE=jwt_bff` を使う際に、Google Cloud Console / Google Auth Platform 側で必要な作業を明文化する。
- さくらVPS 上の Quadlet 構成へ Google OIDC を載せる前提条件を整理する。

前提:
- 2026-04-07 時点の Google Auth Platform UI を前提にする。
- ERP4 は Google ログイン用途として `openid email profile` のみを要求する。
- backend は OAuth 2.0 Authorization Code Flow を実装し、callback は backend が受ける。

## この手順が対象にする構成
- 推奨構成: `AUTH_MODE=jwt_bff`
- backend 公開 origin: `https://api.example.com`
- frontend 公開 origin: `https://app.example.com`
- Google callback: `https://api.example.com/auth/google/callback`

重要:
- Google Auth Platform の Web application client は、`localhost` を除き plain HTTP を許可しない。
- raw IP は `Authorized JavaScript origins` / `Authorized redirect URIs` に登録できない。
- したがって、さくらVPS 実機で Google OIDC を試す場合も、Google 側の登録値は FQDN + HTTPS 前提とする。`http://<VPS_IP>:3001/auth/google/callback` は使えない。

## 事前に決める値

| 項目 | 例 | ERP4 側の対応 |
| --- | --- | --- |
| frontend origin | `https://app.example.com` | `AUTH_FRONTEND_ORIGIN`, `ALLOWED_ORIGINS` |
| backend origin | `https://api.example.com` | `VITE_API_BASE` |
| redirect URI | `https://api.example.com/auth/google/callback` | `GOOGLE_OIDC_REDIRECT_URI` |
| OAuth client name | `erp4-prod-web` | 管理用名称 |
| Google Workspace ドメイン | `example.com` | Audience=Internal の判断材料 |
| support email | `it-admin@example.com` | Branding / verification 用 |
| homepage URL | `https://app.example.com/` | External / Production 運用時に必要になりうる |
| privacy policy URL | `https://app.example.com/privacy` | External / Production 運用時に必要になりうる |

運用方針:
- dev / stage / prod は Google Cloud project か OAuth client を分離する。
- secret は console 作成直後に安全な保管先へ退避する。後から全文再表示できない前提で扱う。

## 1. Google Cloud project を作成または選択する
1. Google Cloud Console で ERP4 用 project を作成または選択する。
2. Google Workspace 内限定で使う場合は、対象 Workspace / Cloud Organization 配下の project を使う。
3. 環境ごとに project もしくは OAuth client を分ける。

判断基準:
- production と trial で client を共有しない。
- redirect URI / support email / verification 状態を環境ごとに分けたい場合は project ごと分離する。

## 2. Google Auth Platform の Branding を設定する
1. `Google Auth Platform` を開く。
2. `Branding` で最低限以下を設定する。
   - App name
   - User support email
3. External / Production 運用、または console 上で要求される場合は以下も設定する。
   - Homepage URL
   - Privacy Policy URL
   - Authorized domains

注意:
- Authorized domains は、origin / redirect URI / homepage / privacy policy で使うドメインを先に追加する。
- Homepage は login 必須ページや別ドメインへの redirect を避ける。
- `app.example.com` と `api.example.com` を使う場合、`example.com` 側のドメイン管理・DNS が先に整っている必要がある。

## 3. Audience を決める
### 推奨: Internal
Google Workspace 内の利用者だけに限定するなら `Internal` を使う。

採用条件:
- 利用者が同一 Workspace 組織に所属している。
- 外部 Gmail / 取引先 Google アカウントにログインさせない。

### External を選ぶ場合
以下のどちらかなら `External` を選ぶ。
- 組織外アカウントでログインさせる必要がある。
- Workspace 外の test user で事前確認したい。

注意:
- External は verification / test user / 公開状態の追加要件が発生することがある。
- cutover 前に console 上の `Audience` / `Data Access` / verification status を確認する。

## 4. Data Access を最小化する
1. `Data Access` で現在の要求 scope を確認する。
2. ERP4 の Google ログイン用途では、`openid`, `email`, `profile` 以外を追加しない。
3. Drive / Gmail / Calendar などの scope を追加する場合は、別の verification 作業と運用審査を前提にする。

判断基準:
- OIDC ログインだけなら `openid email profile` で十分。
- scope 追加は verification だけでなく、説明文書・privacy policy・運用審査の見直しを伴う。

## 5. OAuth client を作成する
1. `Google Auth Platform` の `Clients` を開く。
2. `CREATE CLIENT` を選ぶ。
3. `Application type` は `Web application` を選ぶ。
4. client 名を入力する。
5. `Authorized redirect URIs` に backend callback を追加する。
   - 例: `https://api.example.com/auth/google/callback`
6. frontend が Google Identity Services を直接使う場合だけ、`Authorized JavaScript origins` を追加する。
   - 例: `https://app.example.com`

ERP4 の現行推奨構成:
- `AUTH_MODE=jwt_bff` だけで運用する場合、ログイン開始は backend の `/auth/google/start` を使う。
- この構成では `Authorized redirect URIs` が必須で、`Authorized JavaScript origins` は不要。
- `VITE_AUTH_MODE` 未設定の Google Identity Services ボタンも併用する場合だけ、`VITE_GOOGLE_CLIENT_ID` と `Authorized JavaScript origins` を設定する。

作成後の取り扱い:
- client ID を控える。
- client secret は作成直後に取得し、シークレットストアへ退避する。
- redirect URI 変更は反映まで数分から数時間かかることがある。

## 6. ERP4 の env へ対応付ける

| Google 側の値 | ERP4 側の設定 |
| --- | --- |
| OAuth client ID | `GOOGLE_OIDC_CLIENT_ID` |
| OAuth client ID | `JWT_AUDIENCE` |
| OAuth client secret | `GOOGLE_OIDC_CLIENT_SECRET` |
| redirect URI | `GOOGLE_OIDC_REDIRECT_URI` |
| frontend public origin | `AUTH_FRONTEND_ORIGIN` |
| frontend public origin | `ALLOWED_ORIGINS` |
| frontend direct GIS 利用時の client ID | `VITE_GOOGLE_CLIENT_ID` |

補足:
- backend の現行実装では、`GOOGLE_OIDC_CLIENT_ID` 未設定時に `JWT_AUDIENCE` を client ID として扱えるが、運用上の曖昧さを避けるため両方を同じ値で明示する。
- Workspace 内限定にしたい場合、主手段は `Audience=Internal` とする。
- `VITE_GOOGLE_CLIENT_ID` は `AUTH_MODE=jwt_bff` の backend redirect フローだけなら不要。

## 7. さくらVPS での実施順
1. 先に `docs/ops/sakura-vps-https-proxy.md` を完了し、`app.example.com` / `api.example.com` を HTTPS で公開できる状態にする。
2. その FQDN を使って Google Auth Platform 側に redirect URI を登録する。
3. backend / frontend / proxy env を更新する。
4. `./scripts/quadlet/check-env.sh`
5. 必要時 `./scripts/quadlet/check-proxy.sh`
6. `./scripts/quadlet/start-stack.sh --include-proxy`
7. `./scripts/quadlet/check-trial-readiness.sh --include-proxy --resolve-ip <VPS_IP>`

重要:
- HTTPS reverse proxy 未導入の段階では、Google OIDC の end-to-end 成功を前提にしない。
- plain HTTP の Quadlet stack 確認と、Google OIDC の実 login 確認は分けて扱う。

## 8. 確認チェックリスト
- Google login 開始で `/auth/google/start` から Google 認証画面へ遷移する。
- callback 後に ERP4 へ戻る。
- backend が session cookie を発行する。
- `redirect_uri_mismatch` が出ない。
- frontend 直接 GIS を使う場合だけ `origin_mismatch` が出ない。
- External 運用時は console の verification / publishing status が意図どおりになっている。

## 9. client secret ローテーション
1. Google Auth Platform の `Clients` で対象 client を開く。
2. `Add Secret` で新 secret を発行する。
3. シークレットストアと ERP4 runtime env を更新する。
4. backend をロールアウトし、Google ログインを確認する。
5. 旧 secret を `Disable` し、問題なければ削除する。

## よくあるエラー
### `redirect_uri_mismatch`
- `GOOGLE_OIDC_REDIRECT_URI` と Google Console の redirect URI が 1 文字でもズレている。
- `http` / `https`、host、port、path の不一致を確認する。
- 変更直後は伝播待ちが必要なことがある。

### `origin_mismatch`
- frontend 直接 GIS を使っているのに `Authorized JavaScript origins` が不足している。
- `AUTH_MODE=jwt_bff` だけなら、frontend 直接 GIS を無効化し、backend redirect に寄せる。

### Google ログインは出るが ERP4 へ戻れない
- backend callback が reverse proxy / Caddy で到達できない。
- `AUTH_FRONTEND_ORIGIN` と `ALLOWED_ORIGINS` が公開 origin と一致していない。

## 関連 Runbook
- Auth Gateway 導入: [google-oidc-auth-gateway-rollout](google-oidc-auth-gateway-rollout.md)
- さくらVPS 試験稼働: [sakura-vps-podman-trial](sakura-vps-podman-trial.md)
- さくらVPS HTTPS reverse proxy: [sakura-vps-https-proxy](sakura-vps-https-proxy.md)
- env チェックリスト: [sakura-vps-env-checklist](sakura-vps-env-checklist.md)

## 参考（2026-04-07 確認）
- Google Cloud Console Help: Manage OAuth Clients
  - https://support.google.com/cloud/answer/15549257?hl=en
- Google API Console Help: Setting up OAuth 2.0（旧 UI だが OAuth client / consent / public vs internal の説明あり）
  - https://support.google.com/googleapi/answer/6158849?hl=en
- Google Cloud Console Help: Submitting your app for verification
  - https://support.google.com/cloud/answer/13461325?hl=en-GB
- Google Cloud Console Help: App Homepage
  - https://support.google.com/cloud/answer/13807376?hl=en
