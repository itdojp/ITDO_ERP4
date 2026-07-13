# Issue #1927 Workflow outbound ports/adapters verification

## 対象

- Issue: #1927 `arch(workflow): Notifications/Chat/Evidenceへの直接依存をport・adapterへ隔離する`
- 対象baseline: `bounded-context-workflow-direction` 4件
- 実施日: 2026-07-13 JST

## 実装概要

Workflow core route/service から後段context（Notifications / Chat / Evidence）への直接importを、application orchestration boundaryへ隔離した。

- `src/routes/approvalRules.ts`
  - `appNotifications` / `chatAckTemplates` の直接importを削除。
  - approval action後の通知・Chat ack template適用を `src/application/workflow/approvalActionEffects.ts` に集約。
- `src/services/approval.ts`
  - `evidenceSnapshot` の直接importと `submitApprovalWithUpdate` を削除。
  - target更新、approval作成、evidence snapshot作成、audit記録を同一transactionで行う処理を `src/application/workflow/submitApproval.ts` へ移動。
- `src/services/actionPolicy.ts`
  - Chat contextの `chatAckLinkTargets` 直接importを削除。
  - Chat ack対象テーブル判定を Workflow 所有の純粋なpolicy contract `src/services/actionPolicyChatAckTargets.ts` へ切り出し。
- `src/services/chatAckLinkTargets.ts`
  - Chat側のvalidationはWorkflowの対象テーブルcontractを参照する形に変更。Chat -> Workflow 方向は依存規約上許容される。
- `packages/backend/bounded-context-registry.cjs`
  - `src/application/workflow/*` を `application-orchestration` layerへ分類。
  - `actionPolicyChatAckTargets` を Workflow contextへ分類。

## before / after dependency graph

### Before

```text
src/routes/approvalRules.ts
  -> src/services/appNotifications.ts      (Workflow -> Notifications violation)
  -> src/services/chatAckTemplates.ts      (Workflow -> Chat violation)

src/services/actionPolicy.ts
  -> src/services/chatAckLinkTargets.ts    (Workflow -> Chat violation)

src/services/approval.ts
  -> src/services/evidenceSnapshot.ts      (Workflow -> Evidence violation)
```

`bounded-context-workflow-direction`: 4件

### After

```text
src/routes/approvalRules.ts
  -> src/application/workflow/approvalActionEffects.ts
       -> src/services/appNotifications.ts
       -> src/services/chatAckTemplates.ts

src/services/actionPolicy.ts
  -> src/services/actionPolicyChatAckTargets.ts

src/services/chatAckLinkTargets.ts
  -> src/services/actionPolicyChatAckTargets.ts

src/application/workflow/submitApproval.ts
  -> src/services/approval.ts
  -> src/services/evidenceSnapshot.ts
  -> src/services/audit.ts
```

`bounded-context-workflow-direction`: 0件

## failure / transaction matrix

| 対象                                  | 変更後の配置                                    | 期待する失敗時挙動                                                                                                                                                     | 検証                                                     |
| ------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| approval outcome/pending notification | `application/workflow/approvalActionEffects.ts` | 通知作成失敗は従来どおりrouteへ伝播し、approval action responseは失敗扱いになる。Chat ack templateは通知成功後に実行する。                                             | `workflowApprovalActionEffects.test.js`                  |
| Chat ack template適用                 | `application/workflow/approvalActionEffects.ts` | 失敗しても従来どおりfail-openで `req.log.warn` に記録し、approval action result自体は返す。                                                                            | `workflowApprovalActionEffects.test.js`                  |
| Chat ack対象テーブル不正              | `services/actionPolicyChatAckTargets.ts`        | 不正targetはDB link lookup前に `unsupported_target` でdenyする。                                                                                                       | `actionPolicy.test.js`                                   |
| submit approval + evidence snapshot   | `application/workflow/submitApproval.ts`        | target更新、approval作成、evidence snapshot作成、`evidence_snapshot_created` auditを同一Prisma transaction内で実行する。snapshot/audit失敗はtransaction rollback対象。 | `approvalAuditMetadata.test.js`                          |
| dependency baseline                   | dependency-cruiser baseline                     | Workflow既知違反4件を削除し、残存baselineはDocuments 2件のみ。                                                                                                         | `npm run arch:bounded-context --prefix packages/backend` |

## ローカル検証

### 実行済み

- `npm ci --prefix packages/backend`
  - 結果: PASS（0 vulnerabilities）
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run prisma:generate --prefix packages/backend`
  - 結果: PASS
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend`
  - 結果: PASS
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend -- test/workflowApprovalActionEffects.test.js test/actionPolicy.test.js test/chatAckLinkTargets.test.js test/approvalAuditMetadata.test.js test/approvalRulesRoutes.test.js test/approvalLogic.test.js test/approvalIdempotency.test.js test/boundedContextCoverage.test.js test/coverageThresholds.test.js`
  - 結果: PASS（83 tests）
- `npm run lint --prefix packages/backend`
  - 結果: PASS
- `npm run format:check --prefix packages/backend`
  - 結果: PASS
- `npm run arch:bounded-context --prefix packages/backend`
  - 結果: PASS（220 modules / 858 dependencies、known violations ignored: 2）
- `npm run arch:bounded-context:coverage --prefix packages/backend`
  - 結果: PASS（210 source files / 199 target route/service/application files、unclassified 0、stale 0）
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend`
  - 結果: PASS（1236 tests）
  - 補足: 既存の vendor invoice fallback audit 系テストで、DB未接続の非致命 `audit log failed` / Prisma P1001 warning が出力されるが、suite はPASS。
- `npm audit --prefix packages/backend --audit-level=high`
  - 結果: PASS（0 vulnerabilities）
- `node scripts/check-test-results-index.mjs`
  - 結果: PASS
- `node scripts/check-doc-image-links.mjs`
  - 結果: PASS（115 image links in 325 markdown files）
- `npm ci --prefix packages/frontend`
  - 結果: PASS（0 vulnerabilities）
- `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`
  - 結果: PASS（105 tests）
  - 補足: Podman DB host portは既定 `55433` が使用中だったため `55434` へ自動フォールバック。

### 追加予定

PR作成後にGitHub Actionsの必須check結果を確認する。
