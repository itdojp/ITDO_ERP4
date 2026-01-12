# テスト結果 2026-01-04 バックエンドスモーク

## 実行日時
- 2026-01-04 16:21 JST

## 対象
- ブランチ: docs/bootstrap
- 変更: PR#287, PR#288 マージ後

## 実行環境
- DB: Podman コンテナ erp4-pg-poc (Postgres 15)
- DB URL: postgresql://postgres:postgres@localhost:55432/postgres?schema=public
- Backend: node packages/backend/dist/index.js (PORT=3002, AUTH_MODE=header)
- BASE_URL: http://localhost:3002

## 手順
1. ./scripts/podman-poc.sh migrate
2. npm run prisma:generate --prefix packages/backend
3. npm run build --prefix packages/backend
4. ./scripts/podman-poc.sh db-push
5. Backend 起動 (PORT=3002)
6. BASE_URL=http://localhost:3002 ./scripts/smoke-backend.sh

## 結果
- migrate: 失敗 (P3005: schema not empty)
- prisma:generate: 成功
- build: 成功
- db-push: 成功
- smoke-backend: 初回失敗（/jobs/alerts/run 500）→ db-push 後に再実行で成功

## ログ抜粋
### 失敗時
```
[9/9] run alert job and approval check
curl: (22) The requested URL returned error: 500
```

### 再実行成功
```
[9/9] run alert job and approval check
smoke ok
```

## 追加メモ
- db-push により Alert 関連のスキーマ差分が反映され、/jobs/alerts/run の 500 が解消。
