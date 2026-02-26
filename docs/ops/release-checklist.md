# リリースチェックリスト（短縮版）

## 事前（必須）
- [x] CI が green（`CI` / `Link Check`）
- [x] `security-audit` が許容範囲（High/Critical なし、または例外が Issue 化済み）
- [x] DB migration 有無を確認（`packages/backend/prisma/migrations/`）
- [ ] バックアップ手順を実施可能（`docs/ops/backup-restore.md`）

## 試験稼働 Go/No-Go（2026-02-26 時点）
- [x] `main` の `CI` が2連続成功（run [22430055698](https://github.com/itdojp/ITDO_ERP4/actions/runs/22430055698) の attempt 1/2 ともに成功）
- [x] `Link Check` は直近5実行で成功（例: [22425842966](https://github.com/itdojp/ITDO_ERP4/actions/runs/22425842966)）
- [x] `security-audit` は最新実行で成功（[22425842948](https://github.com/itdojp/ITDO_ERP4/actions/runs/22425842948) の `security-audit` job）
- [ ] 既知の運用残課題を解消または受容判断（#543 #544 #914 #1153）
- [x] Go/No-Go 判定ログを #1260 に集約

## 実施
- [ ] タグ付け（`vX.Y.Z`）
- [ ] Release workflow 実行（`.github/workflows/release.yml`）
- [ ] DB migration 適用（必要時）
- [ ] backend デプロイ/起動（`/healthz` / `/readyz`）
- [ ] frontend 配信（静的アセット）

## 事後（必須）
- [ ] 手動確認（最小）: `docs/manual/manual-test-checklist.md`
- [ ] 監視（エラー率/遅延/依存障害）
- [ ] 問題があれば Feature Flag で無効化、または成果物ロールバック
