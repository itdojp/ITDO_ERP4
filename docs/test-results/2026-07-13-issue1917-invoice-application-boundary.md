# Issue #1917 Invoice application boundary verification

## 対象

- Issue: #1917 `arch(documents): invoicesのWorkflow/Notification直接依存を解消する`
- Scope: `packages/backend/src/routes/invoices.ts` の submit / mark-paid orchestration
- 目的: Documents route から Workflow / Notifications への直接依存を削減し、#1905/#1916 の application orchestration / ports pattern を invoice 状態遷移に適用する。

## 実装概要

- `packages/backend/src/application/invoices/useCases.ts` を追加した。
  - `submitInvoiceForApproval`: invoice submit の ActionPolicy、policy audit、approval transaction、approval pending notification を Fastify 非依存 use case に移動。
  - `markInvoicePaid`: mark-paid の ActionPolicy、policy audit、status guard、paid field update、invoice audit を Fastify 非依存 use case に移動。
- `packages/backend/src/routes/invoices.ts` は schema / RBAC / DTO / HTTP response mapping に寄せた。
- `src/application/invoices/**` を `bounded-context-registry.cjs` の `application-orchestration` layer に追加した。
- `dependency-cruiser-known-violations.json` から invoice route 起点の既知違反 5 件を削除した。

## Inventory / scope decision

| route / operation                                      | decision                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `GET /invoices` / `GET /projects/:projectId/invoices`  | list / project scope / date validation は Documents route 内に維持       |
| `GET /invoices/:id`                                    | get / project scope check は Documents route 内に維持                    |
| `POST /projects/:projectId/invoices`                   | numbering / create / estimate・milestone project validation は維持       |
| `POST /projects/:projectId/invoices/from-time-entries` | source time entry grouping / transaction / numbering は後続分割候補      |
| `POST /invoices/:id/release-time-entries`              | draft guard と billed flag release は後続分割候補                        |
| `POST /invoices/:id/submit`                            | Workflow / Notification / ActionPolicy orchestration を use case へ移動  |
| `POST /invoices/:id/mark-paid`                         | ActionPolicy / Audit orchestration と paid transition を use case へ移動 |

PDF / email send は #1917 の非対象であり、`routes/send.ts` 側の後続Issueと責務を混同しない。

## Before / after dependency baseline

| baseline           | count |
| ------------------ | ----: |
| before Issue #1917 |    38 |
| after Issue #1917  |    33 |
| reduced            |     5 |

削除した direct import baseline entry:

- `src/routes/invoices.ts` → `src/services/actionPolicy.ts`
- `src/routes/invoices.ts` → `src/services/actionPolicyAudit.ts`
- `src/routes/invoices.ts` → `src/services/actionPolicyErrors.ts`
- `src/routes/invoices.ts` → `src/services/appNotifications.ts`
- `src/routes/invoices.ts` → `src/services/approval.ts`

## Transaction / notification policy

- submit では既存どおり、invoice status update と approval instance / evidence snapshot creation を `submitApprovalWithUpdate` transaction 内で実行する。
- ActionPolicy が存在する場合は transaction 前に deny / reason requirement を評価し、deny 時は downstream update / notification を実行しない。
- 対象 invoice が存在しない場合は既存挙動どおり policy 評価をスキップし、`submitApprovalWithUpdate` の invoice update path に判定を委ねる。
- approval transaction が失敗した場合、approval pending notification は実行しない。
- notification 失敗は transaction 後に発生するため、既存挙動どおり approval transaction は rollback しない。失敗は呼び出し元へ伝播する。
- mark-paid では既存順序どおり、invoice lookup → ActionPolicy → policy audit → cancelled/rejected status guard → paid update → `invoice_mark_paid` audit の順で実行する。

## Test coverage added

`packages/backend/test/invoiceApplicationUseCases.test.js` を追加し、以下を固定した。

- submit で ActionPolicy state / reasonText を評価し、approval transaction 後に notification を実行すること。
- missing invoice submit の互換挙動（policy skip、approval update path へ委譲）。
- ActionPolicy `reason_required` の 400 `REASON_REQUIRED` mapping。
- notification 失敗が approval transaction 後に伝播すること。
- mark-paid の missing invoice 404 が policy evaluation 前に返ること。
- mark-paid の ActionPolicy denial が update / audit 前に止まること。
- mark-paid の policy-before-invalid-status ordering。
- mark-paid の paid fields と `invoice_mark_paid` audit metadata。

既存 route tests は list/get/create/from-time-entries/release/mark-paid/submit の HTTP互換と、`phase2_core` / `phase3_strict` ActionPolicy preset 互換を継続確認する。

## Local verification

| command                                                                                                                                                                                                                                        | result                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm ci --prefix packages/backend`                                                                                                                                                                                                             | PASS（0 vulnerabilities）                                                            |
| `DATABASE_URL=... npm run prisma:generate --prefix packages/backend`                                                                                                                                                                           | PASS                                                                                 |
| `DATABASE_URL=... npm run build --prefix packages/backend`                                                                                                                                                                                     | PASS                                                                                 |
| `cd packages/backend && DATABASE_URL=... node scripts/run-tests.js test/invoiceApplicationUseCases.test.js test/invoiceMutationRoutes.test.js test/invoicePolicyEnforcementPreset.test.js test/invoiceMarkPaidPolicyEnforcementPreset.test.js` | PASS（39 tests。既存の audit fallback P1001 warning は非致命）                       |
| `npm run lint --prefix packages/backend`                                                                                                                                                                                                       | PASS                                                                                 |
| `npm run format:check --prefix packages/backend`                                                                                                                                                                                               | PASS                                                                                 |
| `npm run arch:bounded-context --prefix packages/backend`                                                                                                                                                                                       | PASS（33 known violations ignored）                                                  |
| `npm run arch:bounded-context:coverage --prefix packages/backend`                                                                                                                                                                              | PASS（source files 201 / target route-service files 190 / unclassified 0 / stale 0） |
| `DATABASE_URL=... npm run test:ci --prefix packages/backend`                                                                                                                                                                                   | PASS（1185 tests。既存の vendor invoice audit P1001 warning は非致命）               |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                                                                                                                                       | PASS（105 tests。Podman DB port fallback 55433 → 55437）                             |

## Notes / constraints

- invoice create/list/get/from-time-entries/release-time-entries は今回の direct Workflow/Notification import 削減の主対象ではないため、route 内に残した。挙動互換は既存 route tests で継続確認する。
- `src/application/invoices/useCases.ts` は Fastify `request` / `reply` を受け取らず、actor / audit context / DTO / port overrides を受け取る。
- `routes/send.ts` の PDF / email send 境界は #1917 の非対象であり、後続 #1922 で扱う。
