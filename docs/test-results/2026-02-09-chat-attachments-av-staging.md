# チャット添付AV（staging）検証

## 目的

- Issue #886 の本番有効化判定に必要な検証結果を記録する。

## 実行情報

- 実行日: 2026-02-09
- 実行者: ootakazuhiko
- 環境: staging
- backend revision: 2f69fbf
- clamd image / tag: docker.io/clamav/clamav:latest
- 実行コマンド: `bash scripts/smoke-chat-attachments-av.sh`

## 結果サマリ

- clean 添付（clamd 稼働中）: 200
- EICAR 添付（clamd 稼働中）: 422 / VIRUS_DETECTED
- clean 添付（clamd 停止後）: 503
- 結論: 期待通り（200/422/503）

## 実行ログ（末尾）

```text
[1/7] setup postgres (podman): erp4-pg-smoke-chat-av (port: 55436)
postgres ready: erp4-pg-smoke-chat-av
[dotenv@17.2.3] injecting env (0) from packages/backend/.env -- tip: ⚙️  load multiple .env files with { path: ['.env.local', '.env'] }
Loaded Prisma config from packages/backend/prisma.config.ts.

Prisma schema loaded from packages/backend/prisma/schema.prisma.
Datasource "db": PostgreSQL database "postgres", schema "public" at "localhost:5432"

🚀  Your database is now in sync with your Prisma schema. Done in 2.66s

npm notice
npm notice New major version of npm available! 10.8.2 -> 11.9.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.9.0
npm notice To update run: npm install -g npm@11.9.0
npm notice
[2/7] start clamd (podman): erp4-clamav-smoke (port: 3311)
[3/7] build backend (if needed)
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
[4/7] start backend (PORT=3003)
backend ready
[5/7] create private group room
room_id=08e8ce67-24eb-459f-9a02-be06a25f3a08
[6/7] post message
message_id=e32a4f8b-7b58-4aae-94e6-d2bf0bfa34b4
[7/7] attachment scan cases
upload clean (clamd up): status=200
upload eicar (clamd up): status=422
error_code=VIRUS_DETECTED
stop clamd and expect 503
upload clean (clamd down): status=503
smoke ok
```
