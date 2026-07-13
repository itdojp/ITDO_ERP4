# Issue #1921 Leave application boundary verification

## Scope

Issue: [#1921 arch(documents): leaveのWorkflow/Evidence/Notification直接依存を解消する](https://github.com/itdojp/ITDO_ERP4/issues/1921)

This change applies the application-orchestration boundary pattern to leave request submit paths while preserving existing leave type checks, date/workday calculation, entitlement checks, conflict checks, evidence requirements, status codes, and notification ordering.

## Before

`packages/backend/src/routes/leave.ts` directly imported the following cross-context services:

- `src/services/actionPolicy.ts`
- `src/services/actionPolicyAudit.ts`
- `src/services/actionPolicyErrors.ts`
- `src/services/annotationReferences.ts`
- `src/services/appNotifications.ts`
- `src/services/approval.ts`

These were tracked as 6 known `bounded-context-documents-direction` violations.

## After

- Added `packages/backend/src/application/leave/useCases.ts`.
- `authorizeLeaveSubmit` owns leave submit ActionPolicy evaluation, denial response mapping, and context-based policy audit.
- `loadLeaveSubmitEvidence` owns AnnotationReference state loading for leave submit, returning only normalized reference identifiers and evidence booleans to avoid copying message/document payload content into route/application logs.
- `submitLeaveRequestForApproval` owns approval transaction status update to `pending_manager` and pending-approval notification dispatch.
- `packages/backend/src/routes/leave.ts` now remains responsible for RBAC, request payload validation, leave type checks, date/time validation, time entry and leave overlap checks, entitlement/balance checks, no-consultation validation, auto-approval, and HTTP response mapping.

## Transaction and failure policy

- Existing submit flow order is preserved: leave lookup and access check -> ActionPolicy -> conflict/date/evidence/entitlement checks -> auto-approve or approval transaction -> pending notification.
- ActionPolicy denial returns before evidence loading, entitlement calculation, approval transaction, or notification side effects.
- Attachment and consultation evidence checks still occur after lead/retroactive checks and before entitlement/approval updates.
- No-approval leave types still update directly in the route, including compensatory leave consumption in the existing transaction boundary.
- Approval-required leave types update `leaveRequest.status` to `pending_manager` inside `submitApprovalWithUpdate`; notifications are created after that transaction and notification failure is propagated after the transaction, matching prior behavior.
- Application evidence normalization copies only `{ kind, refId }` for internal references and URL strings for external evidence. It does not copy chat message text, document titles, notes, or other personal/health-information payloads.

## Bounded-context evidence

Known baseline count changed from 18 to 12:

| Rule                                        | Before | After |
| ------------------------------------------- | -----: | ----: |
| `bounded-context-documents-direction`       |     12 |     6 |
| `bounded-context-identity-access-direction` |      2 |     2 |
| `bounded-context-workflow-direction`        |      4 |     4 |
| **Total**                                   | **18** | **12** |

The removed baseline entries are all from `src/routes/leave.ts` to the six services listed in the Before section. The new application file is classified by `application-orchestration` in `packages/backend/bounded-context-registry.cjs`.

## Local verification

Commands executed locally so far:

```bash
npm ci --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run prisma:generate --prefix packages/backend
npm run build --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node packages/backend/scripts/run-tests.js packages/backend/test/leaveApplicationUseCases.test.js packages/backend/test/leavePolicyEnforcementPreset.test.js packages/backend/test/leaveTypeRoutes.test.js packages/backend/test/leaveEntitlements.test.js packages/backend/test/leaveCompGrants.test.js packages/backend/test/leaveWorkdayCalendar.test.js packages/backend/test/approvalEvidenceGate.test.js
node scripts/report-action-policy-callsites.mjs --format=json
node scripts/report-action-policy-required-action-gaps.mjs --format=json
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node packages/backend/scripts/run-tests.js packages/backend/test/actionPolicyCallsitesReport.test.js packages/backend/test/actionPolicyRequiredActionGapsReport.test.js packages/backend/test/actionPolicyPhase3ReadinessReport.test.js packages/backend/test/leaveApplicationUseCases.test.js
npm run lint --prefix packages/backend
npm run format:check --prefix packages/backend
npm run arch:bounded-context --prefix packages/backend
npm run arch:bounded-context:coverage --prefix packages/backend
node scripts/check-test-results-index.mjs
node scripts/check-doc-image-links.mjs
git diff --check
npm audit --prefix packages/backend --audit-level=high
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

Current local results:

- `npm ci --prefix packages/backend`: PASS, 0 vulnerabilities.
- `prisma:generate`: PASS.
- `npm run build --prefix packages/backend`: PASS.
- Targeted leave application / policy / leave type / entitlement / comp-grant / workday / approval-evidence tests: PASS, 54 tests.
- ActionPolicy callsite report: PASS; `leave:submit` is now detected at `packages/backend/src/application/leave/useCases.ts`.
- ActionPolicy required-action gap report: PASS; missing static callsites 0, dynamic callsites 0.
- Targeted ActionPolicy callsite / required-actions / Phase3 readiness / leave application tests: PASS, 20 tests.
- `npm run lint --prefix packages/backend`: PASS.
- `npm run format:check --prefix packages/backend`: PASS.
- `npm run arch:bounded-context --prefix packages/backend`: PASS, 12 known violations ignored.
- `npm run arch:bounded-context:coverage --prefix packages/backend`: PASS, 205 source files / 194 target route-service files / unclassified 0 / stale 0.
- `node scripts/check-test-results-index.mjs`: PASS.
- `node scripts/check-doc-image-links.mjs`: PASS, 115 image links in 319 markdown files.
- `git diff --check`: PASS.
- `npm audit --prefix packages/backend --audit-level=high`: PASS, 0 vulnerabilities.
- `npm run test:ci --prefix packages/backend`: PASS, 1,210 tests.
- `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`: PASS, 105 tests; Podman DB port fallback 55433 -> 55437.
- Existing non-fatal `auditLog.create` P1001 warnings appeared in route tests when fallback audit attempted to write through the real audit client without a live local DB; tests still passed and this behavior is consistent with existing backend test runs.
