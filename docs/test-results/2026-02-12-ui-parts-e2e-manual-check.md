# 新UIパーツ取込後の確認（E2E/マニュアル）

実施日: 2026-02-12

## 対象

- DateRangePicker / DateTimeRangePicker
- EntityReferencePicker
- MentionComposer
- Drawer
- PolicyFormBuilder
- AuditTimeline / DiffViewer

## 実施内容

1. 既存 E2E とマニュアルを棚卸しし、未カバー箇所を特定
2. `packages/frontend/e2e/frontend-smoke.spec.ts` に不足導線を追加
   - 経費注釈 Drawer + EntityReferencePicker 保存/再表示
   - ProjectChat の MentionComposer 候補選択
   - HR分析 / 監査ログ の DateRangePicker 入力
   - Break-glass（mgmt ロール）で DateTimeRangePicker 入力
   - 承認ルール / ActionPolicy の履歴表示で AuditTimeline + DiffViewer 表示確認
3. 利用者/管理者マニュアルと手動チェックリストを更新

## 実行コマンド

```bash
npm run lint --prefix packages/frontend
npm run typecheck --prefix packages/frontend
E2E_CAPTURE=0 E2E_GREP="frontend smoke core|frontend smoke reports masters settings|frontend smoke chat hr analytics|frontend smoke additional sections|frontend smoke admin ops" ./scripts/e2e-frontend.sh
```

## 結果

- frontend lint/typecheck: 成功
- Playwright（対象 5 シナリオ）: 5 passed
- 証跡出力先: `docs/test-results/2026-02-12-frontend-e2e`（`E2E_CAPTURE=0` のためスクリーンショット未出力）
