# Google OIDC Auth Gateway 導入手順

## 目的

`AUTH_MODE=jwt_bff` を使って、Google Workspace OIDC を ERP4 の本番認証経路として導入する際の最小 Runbook を示す。

## 前提

- backend は `PR #1503` 相当の `jwt_bff` 実装を含むこと
- frontend は `PR #1504` 相当の `VITE_AUTH_MODE=jwt_bff` 実装を含むこと
- Google Workspace 側で OAuth クライアントを発行済みであること
- reverse proxy で TLS 終端すること
- 本番で `AUTH_MODE=header` を使わないこと

## Google Workspace 側の設定

### OAuth クライアント

- 種別: Web application
- 必須設定
  - `Authorized JavaScript origins`
    - `https://<frontend-origin>`
  - `Authorized redirect URIs`
    - `https://<backend-origin>/auth/google/callback`

### 運用判断

- 初期本番では Google グループを一次ソースにしない
- Google 側の MFA / Passkey / 端末制御を有効化する
- ERP4 は Google パスワードや refresh token を保持しない

## backend 環境変数

最低限必要な設定例:

```dotenv
NODE_ENV=production
AUTH_MODE=jwt_bff
ALLOWED_ORIGINS=https://app.example.com

GOOGLE_OIDC_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_OIDC_CLIENT_SECRET=replace-me
GOOGLE_OIDC_REDIRECT_URI=https://api.example.com/auth/google/callback
GOOGLE_OIDC_AUTH_URL=https://accounts.google.com/o/oauth2/v2/auth
GOOGLE_OIDC_TOKEN_URL=https://oauth2.googleapis.com/token
GOOGLE_OIDC_JWKS_URL=https://www.googleapis.com/oauth2/v3/certs
GOOGLE_OIDC_ISSUER=https://accounts.google.com
GOOGLE_OIDC_SCOPES=openid email profile
GOOGLE_OIDC_HOSTED_DOMAIN=example.com
GOOGLE_OIDC_SESSION_COOKIE_NAME=erp4_session
GOOGLE_OIDC_SESSION_TTL_MINUTES=480
GOOGLE_OIDC_SESSION_IDLE_TTL_MINUTES=60
GOOGLE_OIDC_FLOW_COOKIE_TTL_MINUTES=15
GOOGLE_OIDC_POST_LOGIN_REDIRECT_URL=https://app.example.com/
```

補足:

- `GOOGLE_OIDC_CLIENT_SECRET` はシークレットストアで管理する
- `GOOGLE_OIDC_JWKS_URL` は backend 実装に合わせた `jwks_uri` を設定する。固定値運用では Google の OpenID Provider Configuration (`https://accounts.google.com/.well-known/openid-configuration`) を確認し、その時点の `jwks_uri` を採用する
- `GOOGLE_OIDC_HOSTED_DOMAIN` を設定し、社外 Google アカウントを既定で拒否する
- `ALLOWED_ORIGINS` には frontend の公開 origin のみを列挙する
- `ALLOWED_ORIGINS` にワイルドカードは使わない。複数 origin を許可する場合は backend 実装に合わせてカンマ区切りで列挙する
- `jwt_bff` では frontend 側が `credentials: 'include'` で API を呼び出す前提のため、backend の `Access-Control-Allow-Credentials` と origin 設定を厳密に一致させる
- `GOOGLE_OIDC_CLIENT_SECRET` のローテーションは、Google Workspace 側で新 secret を発行 → シークレットストア更新 → backend ロールアウト → 動作確認後に旧 secret を失効、の順で行う
- `GOOGLE_OIDC_CLIENT_SECRET` の漏洩が疑われる場合は、直ちに secret を失効または再発行し、必要に応じて `AuthSession` を全削除して強制再ログインさせる

## frontend 環境変数

```dotenv
VITE_AUTH_MODE=jwt_bff
VITE_API_BASE=https://api.example.com
```

補足:

- `jwt_bff` では frontend から Bearer token を保持しない
- API 呼び出しは Cookie ベースになるため、frontend / backend は TLS 前提とする

## reverse proxy 要件

- backend と frontend を HTTPS で公開する
- `Set-Cookie` を書き換えず透過する
- `X-Forwarded-Proto=https` を backend へ渡す
- backend の OIDC callback を proxy で遮断しない
- Cookie は少なくとも `Secure`, `HttpOnly` を必須とし、`SameSite` は site 構成に応じて設定する
  - frontend / backend が同一 site 構成の場合: `SameSite=Lax` を推奨
  - クロスサイトになる構成で OIDC ログインや BFF + Cookie 認証を行う場合: `SameSite=None; Secure` を必須とする

## 起動確認

### backend

```bash
npm ci --prefix packages/backend
npx prisma generate --schema packages/backend/prisma/schema.prisma
npm run build --prefix packages/backend
node packages/backend/dist/index.js
```

### frontend

```bash
npm ci --prefix packages/frontend
VITE_AUTH_MODE=jwt_bff VITE_API_BASE=https://api.example.com npm run build --prefix packages/frontend
```

## 確認項目

- 未ログイン時に `Googleでログイン` ボタンのみ表示される
- `/auth/google/start` で Google 認証画面へ遷移する
- callback 後に `erp4_session` Cookie が発行される
- `GET /auth/session` が 200 を返し、`UserIdentity -> UserAccount` 解決ができる
- `POST /auth/logout` で Cookie が破棄される
- `AUTH_MODE=jwt_bff` 以外では BFF route が `404` を返す

## ロールバック

- `AUTH_MODE=jwt_bff` の切替を戻す前に、frontend も `VITE_AUTH_MODE` を同期して戻す
- OIDC callback URL を削除する前に backend 切替を完了する
- `AuthSession` / `AuthOidcFlow` テーブルは監査のため即時削除しない

## 既知の制約

- Google グループは初期本番では一次ソースにしない
- `UserIdentity` が未リンクの Google ユーザはログイン完了できない
- `jwt_bff` での未認証 UI 導線は導入中のため、追加の E2E と運用証跡取得を継続する
