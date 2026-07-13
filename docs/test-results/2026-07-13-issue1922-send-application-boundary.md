# Issue #1922 Send application boundary verification

## Scope

- Issue: #1922 `arch(documents): send routeのWorkflow/Evidence直接依存を解消する`
- Target route: `packages/backend/src/routes/send.ts`
- New application boundary: `packages/backend/src/application/send/useCases.ts`

## Before / after dependency boundary

### Before

`src/routes/send.ts` directly imported Workflow/Evidence services:

- `../services/actionPolicy.js`
- `../services/actionPolicyAudit.js`
- `../services/actionPolicyErrors.js`
- `../services/approvalEvidenceGate.js`

The known bounded-context baseline contained 4 `src/routes/send.ts` entries.

### After

`src/routes/send.ts` delegates send/retry orchestration to Fastify-independent use cases and no longer imports the target Workflow/Evidence services directly.

- `sendInvoiceDocument`
- `sendEstimateDocument`
- `sendPurchaseOrderDocument`
- `retryDocumentSend`

The application layer accepts actor context, audit context, DTO fields, and testable ports. It does not accept Fastify `request` / `reply` objects.

Known bounded-context baseline changed from 12 to 8 entries:

- `bounded-context-documents-direction`: 6 -> 2
- `bounded-context-identity-access-direction`: 2 -> 2
- `bounded-context-workflow-direction`: 4 -> 4

## Preserved send sequence

Initial send keeps the existing order:

1. Route RBAC and DTO extraction
2. Target document lookup
3. ActionPolicy evaluation
4. ActionPolicy denial mapping (`REASON_REQUIRED`, `ACTION_POLICY_DENIED`, `APPROVAL_REQUIRED`)
5. Approval/Evidence gate
6. ActionPolicy fallback/override audit
7. Template resolution
8. PDF generation
9. Failed send log + failed audit on PDF failure
10. Requested send log
11. Requested audit
12. Stub/SMTP/SendGrid notification call
13. Transactional document update + send-log update
14. Completed/failed audit with provider Message-ID

Retry keeps existing fail-safe/idempotency controls:

- terminal/success-like send-log statuses return `already_sent`
- cooldown returns `retry_too_soon`
- unsupported target table returns `unsupported_target`
- retry logs carry `metadata.retryOf`
- external send is not attempted before status/cooldown/target/template/PDF checks pass

## Tests added

`packages/backend/test/sendApplicationUseCases.test.js` covers:

- invoice send normal sequence and Message-ID propagation
- approval/evidence shortage stopping before PDF/external send/send-log creation
- ActionPolicy reason-required denial stopping before evidence/external send
- PDF generation failure creating failed send log and failed audit without external send
- purchase order send normal path without invoice-only `emailMessageId` update field
- retry log creation, `retryOf` metadata, completed audit, and Message-ID propagation
- retry duplicate/idempotency blocks: `already_sent` and `retry_too_soon`

Existing route-level tests continue to cover policy preset behavior, audit route behavior, SendGrid event audit handling, approval evidence gate, action-policy errors, and fallback audit.

## Verification commands

Executed locally in `worktrees/send-orchestration-1922-20260713`:

```bash
npm ci --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run prisma:generate --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node packages/backend/scripts/run-tests.js packages/backend/test/sendApplicationUseCases.test.js
node scripts/report-action-policy-required-action-gaps.mjs --format=json
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node packages/backend/scripts/run-tests.js packages/backend/test/actionPolicyCallsitesReport.test.js packages/backend/test/actionPolicyRequiredActionGapsReport.test.js packages/backend/test/actionPolicyPhase3ReadinessReport.test.js packages/backend/test/sendApplicationUseCases.test.js packages/backend/test/sendPolicyEnforcementPreset.test.js packages/backend/test/sendAuditRoutes.test.js packages/backend/test/sendEventAuditRoutes.test.js
npm run arch:bounded-context --prefix packages/backend
npm run arch:bounded-context:coverage --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

Results:

- Backend build: PASS
- Send application unit tests: PASS, 7 tests
- ActionPolicy callsite / required-actions / Phase3 readiness / send targeted regression suite: PASS, 44 tests
- ActionPolicy required-action gaps: PASS, missing/stale/dynamic all 0
- Bounded-context dependency gate: PASS, 8 known violations ignored
- Bounded-context coverage gate: PASS, 206 source files / 195 target route-service files / unclassified 0 / stale 0
- Full backend test suite: PASS, 1,219 tests
- Local core E2E: PASS, 105 tests

## Notes

- Tests use injected ports and existing route-level stubs; no production mail credentials are used.
- The route still owns RBAC, rate-limit configuration, Fastify request parsing, and read-only send-log endpoints.
- PDF and notification transports remain infrastructure adapters behind application ports for send/retry orchestration.
