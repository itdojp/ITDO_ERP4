# リリースチェックリスト（短縮版）

## 事前（必須）
- [ ] CI が green（`CI` / `Link Check`）
- [ ] `security-audit` が許容範囲（High/Critical なし、または例外が Issue 化済み）
- [ ] DB migration 有無を確認（`packages/backend/prisma/migrations/`）
- [ ] バックアップ手順を実施可能（`docs/ops/backup-restore.md`）

## 実施
- [ ] タグ付け（`vX.Y.Z`）
- [ ] Release workflow 実行（`.github/workflows/release.yml`）
- [ ] DB migration 適用（必要時）
- [ ] backend デプロイ/起動（`/healthz` / `/readyz`）
- [ ] frontend 配信（静的アセット）

## 事後（必須）
- [ ] 手動確認（最小）: `docs/requirements/manual-test-checklist.md`
- [ ] 監視（エラー率/遅延/依存障害）
- [ ] 問題があれば Feature Flag で無効化、または成果物ロールバック

