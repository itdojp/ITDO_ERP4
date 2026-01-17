# 障害対応（一次切り分け Runbook）

## まず確認すること（共通）
1. `/healthz`（liveness）: `200` か
2. `/readyz`（readiness）: `200` か（`503` の場合は依存障害）
3. request-id（`x-request-id`）の取得（クライアント側/ログ）

ログの見方（request-id 起点）は `docs/ops/observability.md` を参照。

## よくある症状と一次切り分け
### DBに接続できない（/readyz が 503）
- DB コンテナ/サービスの稼働確認
- `DATABASE_URL` の設定確認
- `scripts/podman-poc.sh start` / `scripts/podman-poc.sh check` の実行（検証環境）

### 依存脆弱性チェックが失敗する（security-audit）
- `npm audit --audit-level=high` の出力を確認し、High/Critical の有無を確認
- 許容する場合は理由と期限を Issue 化する（運用）

### レート制限で API が弾かれる
- `RATE_LIMIT_ENABLED` / `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` を確認
- health/readiness は allowlist のため通常は影響しない

