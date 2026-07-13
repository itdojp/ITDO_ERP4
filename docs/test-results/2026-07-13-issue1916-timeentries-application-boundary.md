# Issue #1916 TimeEntries application boundary verification

## 対象

- Issue: #1916 `arch(documents): timeEntriesのWorkflow/Notification直接依存を解消する`
- Scope: `packages/backend/src/routes/timeEntries.ts` の patch / submit / reassign orchestration
- 目的: Documents route から Workflow / Notifications への直接依存を削減し、#1905 で確立した application orchestration / ports pattern を time entry に適用する。

## 実装概要

- `packages/backend/src/application/timeEntries/useCases.ts` を追加した。
  - `patchTimeEntry`: 重要項目変更時の承認申請、ActionPolicy、override audit、notification、通常更新を Fastify 非依存 use case に移動。
  - `submitTimeEntry`: submit action の ActionPolicy enforcement と status update を移動。
  - `reassignTimeEntry`: reassignment reason、pending approval、target project、period lock、task resolution、audit、reassignment log を移動。
- `packages/backend/src/routes/timeEntries.ts` は schema / RBAC / project access preHandler / DTO / HTTP response mapping に寄せた。
- `src/application/timeEntries/**` を `bounded-context-registry.cjs` の `application-orchestration` layer に追加した。
- `dependency-cruiser-known-violations.json` から timeEntries route 起点の既知違反 7 件を削除した。

## Before / after dependency baseline

| baseline           | count |
| ------------------ | ----: |
| before Issue #1916 |    45 |
| after Issue #1916  |    38 |
| reduced            |     7 |

削除した direct import baseline entry:

- `src/routes/timeEntries.ts` → `src/services/actionPolicy.ts`
- `src/routes/timeEntries.ts` → `src/services/actionPolicyAudit.ts`
- `src/routes/timeEntries.ts` → `src/services/actionPolicyErrors.ts`
- `src/routes/timeEntries.ts` → `src/services/appNotifications.ts`
- `src/routes/timeEntries.ts` → `src/services/approval.ts`
- `src/routes/timeEntries.ts` → `src/services/periodLock.ts`
- `src/routes/timeEntries.ts` → `src/services/reassignmentLog.ts`

## Transaction / notification policy

- 重要項目変更時の time entry update と approval instance / evidence snapshot creation は、既存 `submitApprovalWithUpdate` transaction 内で継続する。
- approval transaction が失敗した場合、notification と `time_entry_modified` audit は実行しない。
- notification 失敗は transaction 後に発生するため、既存挙動どおり approval transaction は rollback しない。失敗は呼び出し元へ伝播し、`time_entry_modified` audit は実行しない。
- reassignment は既存順序どおり、pending approval → target project → period lock → task resolution → update → audit → reassignment log の順で実行する。

## Test coverage added

`packages/backend/test/timeEntryApplicationUseCases.test.js` を追加し、以下を固定した。

- patchで重要項目変更時のみ approval / notification / audit が実行されること。
- 重要項目以外の更新では approval / notification を起動しないこと。
- ActionPolicy `reason_required` の 400 `REASON_REQUIRED` mapping。
- policy未適用かつロック対象のself editで 403 `WORKLOG_LOCKED` mapping。
- notification失敗時の transaction 後 failure propagation。
- approval transaction失敗時に notification / audit が実行されないこと。
- reassignment reason必須、pending approval、period lock、task resolution、audit / reassignment log metadata。
- submit action の ActionPolicy denial が downstream update 前に止まること。

既存 `packages/backend/test/timeEntriesPolicyEnforcementPreset.test.js` は route経由の phase2_core / phase3_strict ActionPolicy互換を継続確認する。

## Local verification

| command                                                                                                                                | result                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm ci --prefix packages/backend`                                                                                                     | PASS（0 vulnerabilities）                                                            |
| `DATABASE_URL=... npm run prisma:generate --prefix packages/backend`                                                                   | PASS                                                                                 |
| `DATABASE_URL=... npm run build --prefix packages/backend`                                                                             | PASS                                                                                 |
| `DATABASE_URL=... node scripts/run-tests.js test/timeEntryApplicationUseCases.test.js test/timeEntriesPolicyEnforcementPreset.test.js` | PASS（19 tests）                                                                     |
| `npm run lint --prefix packages/backend`                                                                                               | PASS                                                                                 |
| `npm run format:check --prefix packages/backend`                                                                                       | PASS                                                                                 |
| `npm run arch:bounded-context --prefix packages/backend`                                                                               | PASS（38 known violations ignored）                                                  |
| `npm run arch:bounded-context:coverage --prefix packages/backend`                                                                      | PASS（source files 200 / target route-service files 189 / unclassified 0 / stale 0） |
| `DATABASE_URL=... npm run test:ci --prefix packages/backend`                                                                           | PASS（1177 tests。既存の vendor invoice audit P1001 warning は非致命）               |
| `npm audit --prefix packages/backend --audit-level=high`                                                                               | PASS（0 vulnerabilities）                                                            |
| `node scripts/check-test-results-index.mjs`                                                                                            | PASS                                                                                 |
| `node scripts/check-doc-image-links.mjs`                                                                                               | PASS（115 image links in 314 markdown files）                                        |
| `git diff --check`                                                                                                                     | PASS                                                                                 |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                               | PASS（105 tests。Podman DB port fallback 55433 → 55437）                             |

## Notes / constraints

- create/list は既存 route 内に残し、cross-context direct import 削減の対象外とした。API shape は変更していない。
- `src/application/timeEntries/useCases.ts` は Fastify `request` / `reply` を受け取らず、actor / audit context / DTO / port overrides を受け取る。
