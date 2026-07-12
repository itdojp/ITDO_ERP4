# Issue #1912 Projects application boundary verification

Date: 2026-07-13 JST
Issue: [#1912](https://github.com/itdojp/ITDO_ERP4/issues/1912)

## Scope

This change extracts the existing `projects.ts` project lifecycle, hierarchy, membership, and task reassignment orchestration into a Fastify-independent application service.

## Implementation evidence

- Added `packages/backend/src/application/projects/useCases.ts`.
  - Accepts actor context, audit context, DTOs, and overrideable ports.
  - Does not accept Fastify `request` / `reply` objects.
  - Keeps existing HTTP error bodies/status mapping at route boundary through application result objects.
- Updated `packages/backend/src/routes/projects.ts`.
  - Route remains responsible for schema/preHandler/DTO extraction/HTTP response only for the extracted flows.
  - Project lifecycle/hierarchy/membership/reassignment routes call application use cases.
- Updated `packages/backend/bounded-context-registry.cjs`.
  - Classifies `src/application/projects/**` as `application-orchestration`.
- Updated `packages/backend/dependency-cruiser-known-violations.json`.
  - Removed the three `src/routes/projects.ts` known violations to `appNotifications.ts`, `periodLock.ts`, and `reassignmentLog.ts`.

## Compatibility notes

- Project create still creates the official project chat room in the same transaction and keeps project-created notification fail-open behavior.
- Project parent change still requires `reasonText`, rejects self-parent, rejects missing/deleted parent, and rejects circular ancestry before update.
- Project status change still writes audit before attempting status notification; notification failure remains fail-open with a warning.
- Member list/candidates/add/bulk/delete keep privileged/admin vs project-leader checks and existing forbidden/unauthorized error bodies.
- Bulk member creation now runs the create batch in one transaction; when the batch create fails, no added/audit/notification success is reported for that batch.
- Task reassignment keeps reason requirement, linked-record guards, billed/approved/pending approval guards, period lock checks, transaction update, audit, and reassignment-log ordering.

## Metrics

| Metric | Before | After |
| --- | ---: | ---: |
| `packages/backend/src/routes/projects.ts` physical lines | 2043 | 1279 |
| temporary max-lines allowance for `src/routes/projects.ts` | 2100 | removed; default 1500 applies |
| dependency-cruiser known violations total | 48 | 45 |
| `src/routes/projects.ts` known bounded-context violations | 3 | 0 |

## Local verification

- `npm ci --prefix packages/backend` — PASS, 0 vulnerabilities.
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npx --prefix packages/backend prisma generate --config packages/backend/prisma.config.ts` — PASS.
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend` — PASS.
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node --test packages/backend/test/projectApplicationUseCases.test.js packages/backend/test/projectMemberRoutes.test.js` — PASS, 5 tests.
- `npm run lint --prefix packages/backend` — PASS.
- `npm run format:check --prefix packages/backend` — PASS.
- `npm run arch:bounded-context --prefix packages/backend` — PASS; 45 known violations ignored.
- `npm run arch:bounded-context:coverage --prefix packages/backend` — PASS; source files 192, target route/service files 181, unclassified 0, stale patterns 0.
- `node scripts/check-test-results-index.mjs` — PASS.
- `node scripts/check-doc-image-links.mjs` — PASS, 115 image links in 310 markdown files.
- `git diff --check` — PASS.
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend` — PASS, 1,142 tests. Existing non-fatal vendor invoice audit `P1001` warnings appeared in fallback tests.
- `npm audit --prefix packages/backend --audit-level=high` — PASS, 0 vulnerabilities.
- `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh` — PASS, 105 tests. Podman DB port auto-fell back from 55433 to 55434.

## Targeted test coverage added

`packages/backend/test/projectApplicationUseCases.test.js` covers:

- circular project parent rejection before update;
- parent/status audit sequencing and status notification fail-open warning;
- bulk member transaction failure response without audit/notification success;
- task reassignment period lock rejection before task/time-entry updates.

## Deferred scope

The following areas remain intentionally deferred to #1913-#1915 and were not restructured in this PR:

- task/WBS/dependency processing beyond the existing task reassignment endpoint;
- milestone processing;
- recurring template/generation log processing;
- projects-specific coverage gate finalization.
