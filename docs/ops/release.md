# リリース（入口）

リリース手順は以下に集約します。
- 戦略/詳細: `docs/ops/release-strategy.md`
- チェックリスト（短縮版）: `docs/ops/release-checklist.md`

## 事前（必須）
- CI が green（`CI` / `Link Check` / `security-audit`）
- DB マイグレーション有無の確認（`packages/backend/prisma/migrations/`）
- バックアップ手順が実施可能であることの確認（`docs/ops/backup-restore.md`）

## 実施
- マイグレーション適用（`prisma migrate deploy`）
- backend デプロイ/起動
- frontend デプロイ/配信
- `/healthz` / `/readyz` の確認
- 手動確認（PoC）: `docs/requirements/manual-test-checklist.md`

## 事後
- 監視（エラー率/遅延/依存障害）
- 重大エラーの request-id を起点に調査（`docs/ops/observability.md`）

## ロールバック（方針）
- 直前のデプロイへ戻す（アプリ）
- DB のロールバックが必要な場合は、リストア手順に従う（破壊的になり得るため要判断）
