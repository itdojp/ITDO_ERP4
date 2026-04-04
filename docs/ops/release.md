# リリース（入口）

リリース手順は以下に集約します。

- 戦略/詳細: `docs/ops/release-strategy.md`
- チェックリスト（短縮版）: `docs/ops/release-checklist.md`

## 事前（必須）

- CI が green（`CI` / `Link Check` / `security-audit`）
- DB マイグレーション有無の確認（`packages/backend/prisma/migrations/`）
- 過去30日以内の backup/restore 証跡を確認（`docs/test-results/YYYY-MM-DD-backup-restore.md` を推奨、実施日時・実施者・使用した archive/log を含む、`docs/ops/backup-restore.md`）
- DB 変更を含む場合は、対象環境に応じて backup 健全性コマンドを実行して結果を証跡へ記録する（例: `./scripts/quadlet/check-db-backup.sh --max-age-hours 24 --print-prefix` / `make backup-s3-readiness-check`）

## 実施

- マイグレーション適用（`prisma migrate deploy`）
- backend デプロイ/起動
- frontend デプロイ/配信
- `/healthz` / `/readyz` の確認
- 手動確認（PoC）: `docs/manual/manual-test-checklist.md`

## 事後

- 監視（エラー率/遅延/依存障害）
- 重大エラーの request-id を起点に調査（`docs/ops/observability.md`）
- UI段階導入対象がある場合、ロールアウト計画の消化状況を確認（例: `docs/ops/ui-rollout-issue-941.md`）

## ロールバック（方針）

- 直前のデプロイへ戻す（アプリ）
- DB のロールバックが必要な場合は、リストア手順に従う（破壊的になり得るため要判断）
