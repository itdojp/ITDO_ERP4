# Issue #941 回帰確認（design-system v1.1.0）

実施日: 2026-02-12

## 対象

- DateRangePicker / DateTimeRangePicker
- EntityReferencePicker
- MentionComposer
- Drawer
- PolicyFormBuilder
- AuditTimeline / DiffViewer

## 実行コマンド

```bash
npm run format:check --prefix packages/frontend
npm run lint --prefix packages/frontend
npm run typecheck --prefix packages/frontend
npm run build --prefix packages/frontend
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

## 結果

- frontend format/lint/typecheck/build: **成功**
- E2E core: **11 passed**
  - backend: delivery due / leave-time conflict / milestone sync / effort variance / recurring template / time-invoice
  - frontend: smoke / task-time-entry link / ux-quality baseline
- E2E証跡: **未保存（`E2E_CAPTURE=0` のためキャプチャなし）**

## 補足

- `Storybook` は本リポジトリ内で運用していないため、UI回帰は Playwright E2E と手動チェックリストで担保する。
