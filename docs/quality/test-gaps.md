# テストギャップ一覧（Test Gaps）

## 目的
主要領域ごとに「現状の自動テスト有無」と「優先度（A/B/C）」を整理し、追加すべきテストを追跡可能にする。

起点（手動確認）
- `docs/requirements/manual-test-checklist.md`
- `packages/backend/src/tests/happy-path.md`

## 優先度の定義
- A: 回帰すると業務/運用に直撃する（PRゲートで検知したい）
- B: 重要だが当面は手動/限定範囲で許容（段階導入）
- C: 改善/拡張（後回しでよい）

## 領域別の整理（現状）
| 領域 | 代表シナリオ | 現状の自動テスト | 優先度 | 次の一手 |
| --- | --- | --- | --- | --- |
| PoC導線（UI） | ダッシュボード→日報→工数→請求 | Playwright E2E（`packages/frontend/e2e`） | A | 重要導線の最小ケースを安定化（flaky排除） |
| PoC導線（API） | プロジェクト/見積/請求/工数/経費のハッピーパス | E2E間接 + 手動スモーク（`scripts/smoke-backend.sh`） | A | unit/integration を追加し、APIの分岐を早期検知 |
| 承認（ルール/ステップ） | 金額閾値/定期案件/並列承認の判定 | backend unit（`packages/backend/test/approvalLogic.test.js`） | A | 追加の分岐（条件マッチ/順序正規化）を継続拡張 |
| RBAC/可視範囲 | 非管理ロールの取得制限（self / project） | backend unit（一部: `packages/backend/test/rbac.test.js`） | A | 主要APIの integration を追加し、実動作も担保 |
| 期日/アラート | 納期・承認遅延・残業等の計算 | backend unit（一部: `packages/backend/test/dueDateRule.test.js`） | A | アラート閾値/集計の境界条件を追加 |
| レポート | 月次/案件別/個人別の集計 | E2E一部 + 手動 | B | 集計の境界条件を unit/integration で追加 |
| 移行（PO→ERP4） | dry-run / apply / 整合チェック | なし（手順のみ） | B | fixtures を用いた dry-run の自動化（実データはコミットしない） |
| バックアップ/リストア | dump→退避→復元 | なし（手順のみ） | B | Podman で最小の restore 検証を自動化し `docs/test-results/` に記録 |
| 添付（AV/ストレージ） | 422/503 などの挙動 | スモーク（`scripts/smoke-chat-attachments-av.sh`） | B | 本番有効化方針確定後にゲート化を検討（Issue #560） |

## 備考
- CI の実行条件/範囲は `docs/quality/quality-gates.md` を正とする。
- 追加したテストは、手動チェックリストのどの項目を代替するかを本ドキュメントで追跡する。
