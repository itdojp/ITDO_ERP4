# UIロールアウト計画（Issue #941）

最終更新: 2026-02-12

## 目的

`@itdo/design-system@1.1.0` 適用範囲（DateRangePicker / EntityReferencePicker / MentionComposer / Drawer / PolicyFormBuilder / AuditTimeline / DiffViewer）を、運用リスクを抑えて段階導入する。

## 対象と適用状況

- `DateRangePicker` / `DateTimeRangePicker`
  - 適用済み: `AuditLogs`, `HRAnalytics`, `ChatBreakGlass`
- `MentionComposer`
  - 適用済み: `ProjectChat`, `RoomChat`
- `EntityReferencePicker`
  - 適用済み: `AnnotationsCard`（内部参照候補検索）
- `Drawer`
  - 適用済み: `Invoices`（一覧→詳細）
  - 適用予定: `Expenses` 注釈導線（PR #950）
- `PolicyFormBuilder`
  - 適用済み: `AdminSettings` の Action Policy 設定
- `AuditTimeline` / `DiffViewer`
  - 適用済み: `AdminSettings` 監査表示

## 段階リリース手順

1. **コード反映**
   - 画面単位で PR を分割し、レビューと CI を通過させる
   - 差分が大きい画面は先に UX 仕様（文言・導線・a11y）を PR 本文で固定する
2. **検証**
   - 必須: frontend `format/lint/typecheck/build`
   - 推奨: `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`
   - UI変更時: `docs/manual/manual-test-checklist.md` の該当項目を目視確認
3. **本番反映**
   - 低リスク画面（表示系）→高リスク画面（投稿/保存系）の順でマージ
   - 重大不具合時は直前コミットを revert して復旧
4. **事後確認**
   - 主要操作（検索/投稿/保存/参照リンク）を手動スモーク
   - 監査ログ・通知表示の異常有無を確認

## Dialog / Drawer 方針

- 一覧コンテキストを維持する詳細/編集は `Drawer` を優先
- 単発確認や破壊的操作確認は `Dialog` / `ConfirmActionDialog` を維持
- 詳細は `docs/ui/dialog-drawer-guideline.md` を参照

## ロールバック方針

- 不具合時は PR 単位で `revert`（画面単位で復旧可能な粒度を維持）
- DBスキーマ変更を伴わない UI 差分はアプリデプロイのみで即時復旧
- スキーマ変更を伴う場合は `docs/ops/release.md` と `docs/ops/backup-restore.md` に従う
