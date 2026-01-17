# 性能ベースライン（PoC導線）

## 目的
PoC導線に関わる主要APIについて、計測条件を固定し、同じ手順で再計測できる状態を作る。

- 計測対象（API/ユースケース）を固定する
- 計測環境（DB/データ量/サーバ設定）を固定する
- 計測結果を `docs/test-results/` に記録し、改善前後を比較できるようにする

## 計測対象（暫定）
PoC導線の代表として、以下を対象とする。

- `GET /projects`（プロジェクト一覧）
- `GET /reports/project-profit/:projectId`（案件損益）
- `GET /reports/project-profit/:projectId/by-user`（案件損益（個人別））

## 前提（環境）
- Podman（DB用）: `podman --version` が利用可能
- Node.js: 18.x 以上（CIは 18.x）。計測結果には使用したバージョンを必ず記録する
- DB: PostgreSQL 15（`scripts/podman-poc.sh` の既定）

## データ条件（暫定）
- `scripts/seed-demo.sql`（既存）
- 追加負荷用: `scripts/perf/seed-perf.sql`（本ドキュメントで規定）

## 計測手順（再現可能性重視）
### 1) DB準備（Podman）
以下は例。必要に応じてポート/コンテナ名を変更する。

```bash
CONTAINER_NAME=erp4-pg-perf HOST_PORT=55434 ./scripts/podman-poc.sh reset
podman exec -e PGPASSWORD=postgres erp4-pg-perf psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /workspace/scripts/perf/seed-perf.sql
```

### 2) backend 起動
```bash
npm install --prefix packages/backend
npm run prisma:generate --prefix packages/backend
npm run build --prefix packages/backend

PORT=3003 AUTH_MODE=header \\
DATABASE_URL=\"postgresql://postgres:postgres@localhost:55434/postgres?schema=public\" \\
node packages/backend/dist/index.js
```

ヘルスチェック:
- `GET http://localhost:3003/healthz`

### 3) pg_stat_statements のリセット
```bash
CONTAINER_NAME=erp4-pg-perf HOST_PORT=55434 ./scripts/podman-poc.sh stats-reset
```

### 4) ベンチ実行
```bash
./scripts/perf/run-api-bench.sh
```

### 5) 結果の保存
以下の成果物を `docs/test-results/` に保存する。

- `perf-YYYY-MM-DD.md`（ベンチ結果・条件・改善差分）

## 計測結果
計測結果は `docs/test-results/perf-YYYY-MM-DD.md` に残す。
