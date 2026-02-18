# 起動/デプロイ（Runbook）

## ローカル/PoC（推奨）
目的: 仕様確認・E2E・簡易検証を最短で回す。

### 前提
- Node.js（CIは 18.x）
- Podman（PostgreSQL 用）

### 手順（E2E起動スクリプト）
フロント/バック/DB をまとめて起動し、E2E（Playwright）まで実行する。

```bash
./scripts/e2e-frontend.sh
```

主な環境変数（必要時のみ）:
- `E2E_DB_MODE=podman|direct`
- `BACKEND_PORT` / `FRONTEND_PORT`

### DBのみ（Podman）
```bash
./scripts/podman-poc.sh start
./scripts/podman-poc.sh reset
```

## 本番相当（概念）
目的: 運用設計（起動順/依存/環境変数）を整理する。

### 起動順（例）
1. DB（PostgreSQL）
2. マイグレーション（`prisma migrate deploy`）
3. backend（Fastify）
4. frontend（静的配信 or Vite build成果物）

### ヘルスチェック
- liveness: `GET /healthz`
- readiness: `GET /readyz`

### 注意
- TLS は reverse proxy 側で終端する前提（アプリ単体でのTLS終端は扱わない）
- `ALLOWED_ORIGINS` を本番の配信元に合わせる（未設定/空の場合は CORS 全拒否）
