# Issue #1914 Projects milestone / recurring template extraction verification

## Scope

- Issue: [#1914](https://github.com/itdojp/ITDO_ERP4/issues/1914)
- Parent: [#1900](https://github.com/itdojp/ITDO_ERP4/issues/1900)
- Branch: `codex/projects-milestone-recurring-1914-20260713`
- Goal: keep the existing milestone and recurring-template HTTP behavior while moving Prisma orchestration, validation, invoice-sync rules, due-date-rule parsing, and recurring-log filtering outside `routes/projects.ts`.

## Implementation summary

| Area                             | Before                                                                                                 | After                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestone HTTP routes            | Inline in `packages/backend/src/routes/projects.ts`                                                    | `packages/backend/src/routes/projects/milestones.ts` registers the HTTP schema/preHandler/DTO boundary.                                                                                         |
| Milestone orchestration          | Route performed milestone CRUD checks, draft-invoice synchronization, and soft delete checks directly. | `packages/backend/src/application/projects/milestoneUseCases.ts` owns create/list/update/delete orchestration and exposes pure create/patch data builders for unit tests.                       |
| Recurring template HTTP routes   | Inline in `packages/backend/src/routes/projects.ts`                                                    | `packages/backend/src/routes/projects/recurring.ts` registers template get/upsert and generation-log listing.                                                                                   |
| Recurring template orchestration | Route parsed `dueDateRule`, `nextRunAt`, and generation-log query limits directly.                     | `packages/backend/src/application/projects/recurringTemplateUseCases.ts` owns template get/upsert/log listing, due-date-rule parsing, limit clamping, and the template/job contract DTO helper. |
| Project route entrypoint         | `projects.ts` mixed lifecycle, membership, task, milestone, and recurring logic.                       | `projects.ts` remains the composition root and registers project task, milestone, and recurring sub-route modules.                                                                              |

## Boundary notes

### Milestone ↔ billing boundary

- Milestone update keeps the existing fail-closed check for submitted/non-draft invoices: a milestone with submitted invoices cannot be updated.
- Amount synchronization is intentionally limited to existing draft invoices linked to the milestone.
- Synchronization still updates only invoice lines that are unambiguous and mechanically derived from the milestone: exactly one line, quantity `1`, and line total matching the invoice total within tolerance.
- Multi-line invoices, quantity changes, and manual total adjustments are skipped with warning logs. This keeps manual billing adjustments under the billing/invoice domain rather than the milestone application use case.
- Milestone delete remains a soft delete and still rejects any non-deleted linked invoice.
- This PR does not add invoice generation or billing-business-spec changes; recurring job generation remains in `packages/backend/src/services/recurring.ts`.

### Recurring template ↔ recurring job boundary

- The recurring template application service is responsible for template persistence, validation, `dueDateRule` normalization, `nextRunAt` parsing, and recurring-generation-log listing.
- The job execution service (`packages/backend/src/services/recurring.ts`) remains responsible for claiming periods, creating estimates/invoices/milestones, computing the next run after execution, and recording job outcomes.
- `toRecurringProjectTemplateJobContract` documents and tests the template fields the job side consumes without moving job execution responsibilities into the route/application layer.

### Date / timezone / dueDateRule

- `dueDateRule` parsing remains centralized in `packages/backend/src/services/dueDateRule.ts` and is now called from the application service instead of the route.
- `nextRunAt` is parsed as an ISO date-time into `Date` by the recurring template application service. Invalid direct-service inputs return `INVALID_NEXT_RUN_AT` before DB mutation.
- `timezone` remains a stored/pass-through template field. No DST or timezone scheduling calculation was introduced in this PR; recurring execution scheduling remains the responsibility of the existing job service.
- Existing API schemas still validate HTTP date/date-time formats before route handlers run.

## Line-count evidence

| File                                                                     | Before #1914 | After #1914 |
| ------------------------------------------------------------------------ | -----------: | ----------: |
| `packages/backend/src/routes/projects.ts`                                |          537 |         195 |
| `packages/backend/src/routes/projects/milestones.ts`                     |            0 |          88 |
| `packages/backend/src/routes/projects/recurring.ts`                      |            0 |          62 |
| `packages/backend/src/application/projects/milestoneUseCases.ts`         |            0 |         340 |
| `packages/backend/src/application/projects/recurringTemplateUseCases.ts` |            0 |         284 |

## Test coverage added

- `packages/backend/test/projectMilestoneApplicationUseCases.test.js`
  - milestone create/list persistence shape and default `billUpon`/date mapping
  - submitted invoice update guard
  - draft invoice amount synchronization for simple derived invoices only
  - skip behavior for manually adjusted, multi-line, and non-quantity-1 invoices
  - linked-invoice delete guard and soft-delete timestamp/reason
- `packages/backend/test/projectRecurringTemplateApplicationUseCases.test.js`
  - recurring frequency, `nextRunAt`, timezone, defaults, and `dueDateRule` mutation data
  - supported frequency and generation-log limit pure helpers
  - template/job contract DTO defaults
  - project-not-found and invalid `dueDateRule` error mapping
  - invalid direct-service `nextRunAt` / frequency guard
  - recurring generation-log filters and limit clamp

## Verification

Initial local verification on `2026-07-13 JST`:

```bash
npm ci --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npx --prefix packages/backend prisma generate --config packages/backend/prisma.config.ts
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node --test \
  packages/backend/test/projectMilestoneApplicationUseCases.test.js \
  packages/backend/test/projectRecurringTemplateApplicationUseCases.test.js \
  packages/backend/test/dueDateRule.test.js \
  packages/backend/test/recurringTemplates.test.js
npm run lint --prefix packages/backend
npm run format:check --prefix packages/backend
npm run arch:bounded-context --prefix packages/backend
npm run arch:bounded-context:coverage --prefix packages/backend
node scripts/check-test-results-index.mjs
node scripts/check-doc-image-links.mjs
git diff --check
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend
npm audit --prefix packages/backend --audit-level=high
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

Observed result:

- `npm ci --prefix packages/backend`: PASS, 0 vulnerabilities.
- Prisma generate: PASS.
- backend build: PASS.
- targeted node tests: PASS, 22 tests.
- backend lint: PASS.
- backend format-check: PASS.
- bounded-context direction: PASS, 45 known violations ignored.
- bounded-context coverage: PASS, 199 source files / 188 target route/service files / unclassified 0 / stale 0.
- test-results index check: PASS after adding this evidence file.
- doc image links: PASS, 115 image links in 312 markdown files.
- `git diff --check`: PASS.
- backend `test:ci`: PASS, 1,160 tests. Existing non-fatal vendor invoice audit P1001 warnings appeared, consistent with prior broad backend runs.
- backend `npm audit --audit-level=high`: PASS, 0 vulnerabilities.
- core E2E: PASS, 105 tests. Podman DB port fallback was `55433 -> 55434`.
