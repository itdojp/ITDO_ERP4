# Issue #1919 Purchase order application boundary verification

## Scope

Issue: [#1919 arch(documents): purchaseOrdersのWorkflow/Notification直接依存を解消する](https://github.com/itdojp/ITDO_ERP4/issues/1919)

This change applies the existing application-orchestration boundary pattern to the purchase order submit-for-approval path.

## Before

`packages/backend/src/routes/purchaseOrders.ts` directly imported Workflow / Notification / ActionPolicy services:

- `src/services/actionPolicy.ts`
- `src/services/actionPolicyAudit.ts`
- `src/services/actionPolicyErrors.ts`
- `src/services/appNotifications.ts`
- `src/services/approval.ts`

These were tracked as 5 known `bounded-context-documents-direction` violations.

## After

- Added `packages/backend/src/application/purchaseOrders/useCases.ts`.
- `submitPurchaseOrderForApproval` owns the purchase order submit orchestration:
  - reads the purchase order status/project scope for policy state;
  - evaluates ActionPolicy with the existing actor contract;
  - treats non-object request bodies as an empty record for `reasonText` extraction;
  - maps `reason_required` to `400 REASON_REQUIRED`;
  - maps other policy denials through `resolveActionPolicyDeniedCode`, including `APPROVAL_REQUIRED` for open approval guard failures;
  - records fallback/override policy audit via context-based audit ports;
  - invokes `submitApprovalWithUpdate` to update the purchase order status to `pending_qa` inside the approval transaction;
  - creates approval-pending notifications after the approval transaction completes.
- `packages/backend/src/routes/purchaseOrders.ts` now remains responsible for HTTP schema/RBAC/DTO extraction, actor/audit context mapping, and HTTP response mapping.
- `create/list/get` route behavior remains unchanged because those paths did not contain the target Workflow / Notification direct dependencies in the current code.

## Transaction and failure policy

- Existing absent-purchase-order behavior is preserved: the route/use case skips ActionPolicy when the purchase order lookup returns null and lets the approval update path determine the final outcome.
- ActionPolicy denial returns before any approval transaction or notification side effect.
- Notification dispatch remains after the approval transaction. A notification failure is propagated after the transaction, matching the previous route-level ordering.
- Numbering, vendor/project existence validation, line/amount validation, and purchase order creation are intentionally unchanged in this PR.
- Generic send route behavior and vendor-invoice linking are intentionally unchanged.

## Bounded-context evidence

Known baseline count changed from 28 to 23:

| Rule                                        | Before |  After |
| ------------------------------------------- | -----: | -----: |
| `bounded-context-documents-direction`       |     22 |     17 |
| `bounded-context-identity-access-direction` |      2 |      2 |
| `bounded-context-workflow-direction`        |      4 |      4 |
| **Total**                                   | **28** | **23** |

The removed baseline entries are all from `src/routes/purchaseOrders.ts` to the five services listed in the Before section. The new application file is classified by `application-orchestration` in `packages/backend/bounded-context-registry.cjs`.

## Local verification

Commands executed locally so far:

```bash
npm ci --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run prisma:generate --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend
cd packages/backend && DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node scripts/run-tests.js test/purchaseOrderApplicationUseCases.test.js test/purchaseOrderPolicyEnforcementPreset.test.js test/purchaseOrderRoutes.test.js
npm run lint --prefix packages/backend
npm run format:check --prefix packages/backend
npm run arch:bounded-context --prefix packages/backend
npm run arch:bounded-context:coverage --prefix packages/backend
npm audit --prefix packages/backend --audit-level=high
node scripts/check-test-results-index.mjs
node scripts/check-doc-image-links.mjs
git diff --check
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

Current local results:

- `npm ci --prefix packages/backend`: PASS, 0 vulnerabilities.
- `prisma:generate`: PASS.
- `npm run build --prefix packages/backend`: PASS.
- Targeted purchase order application / policy / route tests: PASS, 17 tests.
- `npm run lint --prefix packages/backend`: PASS.
- `npm run format:check --prefix packages/backend`: PASS.
- `npm run arch:bounded-context --prefix packages/backend`: PASS, 23 known violations ignored.
- `npm run arch:bounded-context:coverage --prefix packages/backend`: PASS, 203 source files / 192 target route-service files / unclassified 0 / stale 0.
- `npm audit --prefix packages/backend --audit-level=high`: PASS, 0 vulnerabilities.
- `node scripts/check-test-results-index.mjs`: PASS.
- `node scripts/check-doc-image-links.mjs`: PASS, 115 image links in 317 markdown files.
- `git diff --check`: PASS.
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend`: PASS, 1,197 tests; existing non-fatal vendor invoice audit P1001 warnings appeared.
- `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`: PASS, 105 tests; Podman DB port fallback 55433 -> 55437. Expected 403/400/409 console errors appeared in negative-path frontend tests.
