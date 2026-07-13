# Issue #1920 VendorDocs application boundary verification

## Scope

Issue: [#1920 arch(documents): vendorDocsのWorkflow/Notification直接依存を解消する](https://github.com/itdojp/ITDO_ERP4/issues/1920)

This change applies the application-orchestration boundary pattern to vendor invoice ActionPolicy / approval / notification paths while preserving existing vendor invoice validation, line/allocation normalization, PO link/unlink, audit metadata, status codes, and transaction ordering.

## Before

`packages/backend/src/routes/vendorDocs.ts` directly imported Workflow / Notification / ActionPolicy services:

- `src/services/actionPolicy.ts`
- `src/services/actionPolicyAudit.ts`
- `src/services/actionPolicyErrors.ts`
- `src/services/appNotifications.ts`
- `src/services/approval.ts`

These were tracked as 5 known `bounded-context-documents-direction` violations. The route also required a temporary `max-lines` allowance of 1700 lines.

## After

- Added `packages/backend/src/application/vendorDocs/useCases.ts`.
- `authorizeVendorInvoiceAction` owns vendor invoice ActionPolicy evaluation for:
  - `update_allocations`
  - `update_lines`
  - `link_po`
  - `unlink_po`
- `submitVendorInvoiceForApproval` owns submit-for-approval orchestration:
  - reads vendor invoice status/project scope for policy state;
  - evaluates ActionPolicy with the existing actor contract;
  - treats non-object request bodies as an empty record for `reasonText` extraction;
  - maps `reason_required` to `400 REASON_REQUIRED`;
  - maps other policy denials through `resolveActionPolicyDeniedCode`;
  - records fallback/override policy audit through context-based audit ports;
  - invokes `submitApprovalWithUpdate` to update status to `pending_qa` inside the approval transaction;
  - creates approval-pending notifications after the approval transaction completes.
- `packages/backend/src/routes/vendorDocs.ts` now remains responsible for HTTP schema/RBAC/DTO extraction, vendor invoice line/allocation/PO validation, DB writes for those domain updates, domain audit log metadata, and HTTP response mapping.
- `routes/vendorDocs.ts` decreased from 1640 to 1394 lines and was removed from the temporary `max-lines` allowlist.

## Transaction and failure policy

- Existing absent-vendor-invoice submit behavior is preserved: the use case skips ActionPolicy when the vendor invoice lookup returns null and lets the approval update path determine the final outcome.
- ActionPolicy denial returns before line/allocation/PO updates, approval transaction, or notification side effects.
- Legacy fallback reason enforcement after submitted statuses is preserved by returning `requiresLegacyReason` from the application authorization result and keeping the domain-specific override audit in the route.
- Vendor invoice line/allocation updates still use their existing delete/create transaction boundary and update the parent invoice timestamp in the same transaction.
- PO link/unlink validation for project/vendor matching remains before DB mutation and after ActionPolicy evaluation, matching the previous route ordering.
- Notification dispatch remains after the approval transaction. A notification failure is propagated after the transaction, matching the previous route-level ordering.

## Bounded-context evidence

Known baseline count changed from 23 to 18:

| Rule                                        | Before |  After |
| ------------------------------------------- | -----: | -----: |
| `bounded-context-documents-direction`       |     17 |     12 |
| `bounded-context-identity-access-direction` |      2 |      2 |
| `bounded-context-workflow-direction`        |      4 |      4 |
| **Total**                                   | **23** | **18** |

The removed baseline entries are all from `src/routes/vendorDocs.ts` to the five services listed in the Before section. The new application file is classified by `application-orchestration` in `packages/backend/bounded-context-registry.cjs`.

## Local verification

Commands executed locally:

```bash
npm ci --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run prisma:generate --prefix packages/backend
npm run build --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node packages/backend/scripts/run-tests.js packages/backend/test/vendorDocApplicationUseCases.test.js packages/backend/test/vendorInvoiceSubmitPolicyEnforcementPreset.test.js packages/backend/test/vendorInvoiceEditPolicyEnforcementPreset.test.js packages/backend/test/vendorInvoiceLinkPoRoutes.test.js packages/backend/test/vendorInvoiceAllocations.test.js packages/backend/test/vendorInvoiceLines.test.js packages/backend/test/vendorInvoiceLineReconciliation.test.js
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node packages/backend/scripts/run-tests.js packages/backend/test/actionPolicyCallsitesReport.test.js packages/backend/test/actionPolicyRequiredActionGapsReport.test.js packages/backend/test/actionPolicyPhase3ReadinessReport.test.js packages/backend/test/vendorDocApplicationUseCases.test.js
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
- Targeted vendor document application / submit policy / edit policy / PO link / allocation / line / reconciliation tests: PASS, 44 tests.
- Targeted ActionPolicy callsite / required-actions / phase3 readiness tests: PASS, 21 tests. The callsite report now scans backend source (`src`) rather than route-only files so application-orchestration use cases remain covered after route extraction.
- `npm run lint --prefix packages/backend`: PASS.
- `npm run format:check --prefix packages/backend`: PASS.
- `npm run arch:bounded-context --prefix packages/backend`: PASS, 18 known violations ignored.
- `npm run arch:bounded-context:coverage --prefix packages/backend`: PASS, 204 source files / 193 target route-service files / unclassified 0 / stale 0.
- `npm audit --prefix packages/backend --audit-level=high`: PASS, 0 vulnerabilities.
- `node scripts/check-test-results-index.mjs`: PASS.
- `node scripts/check-doc-image-links.mjs`: PASS, 115 image links in 318 markdown files.
- `git diff --check`: PASS.
- `npm run test:ci --prefix packages/backend`: PASS, 1,204 tests. Existing non-fatal `auditLog.create` P1001 warnings appeared in vendor invoice route fallback-audit tests when the real DB client was used without a live local DB; tests still passed and this behavior is consistent with existing backend test runs.
- `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`: PASS, 105 tests; Podman DB port fallback 55433 -> 55434. Expected 403/400/409 console errors appeared in negative-path frontend tests.
