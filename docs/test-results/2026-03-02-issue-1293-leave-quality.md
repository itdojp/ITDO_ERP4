# ISSUE #1293 品質強化の証跡（2026-03-02）

対象: 休暇管理強化（#1283〜#1292）に対するテスト/ドキュメント整合確認

## 1. 実行コマンド

### Backend（対象テスト）

```bash
DATABASE_URL='postgresql://user:pass@localhost:5432/postgres?schema=public' npm run prisma:generate --prefix packages/backend
DATABASE_URL='postgresql://user:pass@localhost:5432/postgres?schema=public' npm run build --prefix packages/backend
DATABASE_URL='postgresql://user:pass@localhost:5432/postgres?schema=public' npm run test:ci --prefix packages/backend -- test/leaveTypeRoutes.test.js test/integrationExportRoutes.test.js
```

結果:
- build: pass
- test: pass（34 passed / 0 failed）

補足:
- テスト実行中に監査ログ書き込みの P1001（`127.0.0.1:5432` 到達不可）がログ出力されるケースあり
- 該当ログはテストの pass/fail 判定には影響しないことを確認

### Frontend（画面操作E2E）

```bash
E2E_GREP="frontend leave submit validation for lead/retroactive/time conflict" E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

結果:
- pass（1 passed / 0 failed）
- 対象: `packages/frontend/e2e/frontend-leave-submit-validation.spec.ts`

補足:
- 実行中に 400/409 応答が出るのは、バリデーション/重複チェック検証シナリオの期待動作

## 2. ISSUE #1293 TODOとの対応

- Phase A-1: `packages/backend/test/leaveTypeRoutes.test.js` で submit期限/重複境界をカバー
- Phase A-2: `packages/frontend/e2e/frontend-leave-submit-validation.spec.ts` を追加済み
- Phase A-3: `packages/backend/test/integrationExportRoutes.test.js` で dispatch冪等/再送/ログ整合をカバー
- Phase B-1: `docs/manual/ui-manual-user.md` 更新済み
- Phase B-2: `docs/manual/ui-manual-admin.md` 更新済み
- Phase B-3: `docs/manual/hr-guide.md` 更新済み
- Phase C-1: `docs/requirements/hr-crm-integration.md` 更新済み
- Phase C-2: `docs/manual/manual-test-checklist.md` 更新済み
- Phase C-3: 本証跡ファイルを追加

