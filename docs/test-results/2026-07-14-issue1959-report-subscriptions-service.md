# Issue #1959 Report Subscriptions Application Boundary Verification

## Summary

- Issue: #1959 `refactor(reports): reportSubscriptionsのschedule・run・history処理をserviceへ抽出しtemporary max-lines allowanceを削除する`
- Parent: #1900
- Date: 2026-07-14
- Branch: `codex/1959-report-subscriptions-service-20260714`
- Scope: `src/routes/reportSubscriptions.ts` から schedule normalize / subscription CRUD / manual run / scheduled run / delivery retry / history orchestration を Fastify 非依存 application service へ抽出し、backend route temporary `max-lines` allowance を削除する。

## Line count and ownership

| File | Before | After | Notes |
| --- | ---: | ---: | --- |
| `packages/backend/src/routes/reportSubscriptions.ts` | 1533 lines | 151 lines | HTTP schema / RBAC / DTO / response mapping only |
| `packages/backend/src/application/reportSubscriptions/useCases.ts` | n/a | 1463 lines | Schedule normalization, CRUD, run, retry, delivery history orchestration |
| `packages/backend/eslint.config.cjs` temporary route allowances | `reportSubscriptions.ts` cap 1600 | empty | backend routes use the default 1500-line gate |

## Responsibility split

| Area | New boundary | Compatibility note |
| --- | --- | --- |
| Schedule normalization | `normalizeReportSubscriptionSchedule` | Keeps current five-field cron-string storage semantics. Timezone suffixes, `nextRunAt`, and DST calculation are not interpreted by the route/job. |
| Subscription list/create/update | `listReportSubscriptions`, `createReportSubscription`, `updateReportSubscription` | Preserves default `isEnabled`, actor metadata, `INVALID_*` errors, and 404 `not_found` mapping. |
| Manual run | `runReportSubscriptionById` / internal `runSubscription` | Creates delivery records before immediate email processing. Updates `lastRunStatus` from delivery statuses without passing Fastify request/reply into the service. |
| Scheduled run | `runDueReportSubscriptions` | Preserves current cron-side scheduling contract: query `isEnabled=true`, `createdAt asc`, `take=200`; no schedule/timezone filter is applied in application code. |
| Retry / delivery | `retryDueReportDeliveries` / internal delivery helpers | Preserves `pending -> sending` and `failed -> retrying` claim locks, retry max/backoff env behavior, permanent failure notification fallback, and pending-before-failed ordering. |
| History | `listReportDeliveries` | Preserves bounded pagination, `subscriptionId` filter, and `sentAt desc` ordering. |

## Schedule / timezone / DST semantics matrix

| Case | Current behavior fixed by #1959 |
| --- | --- |
| Valid schedule | Trimmed five-field cron string is accepted and stored as a string, e.g. `0 6 * * *`. |
| Whitespace schedule | Blank / whitespace-only schedule is treated as absent. |
| Invalid schedule | Non five-field cron-like strings raise `INVALID_SCHEDULE`. |
| Timezone suffix | `0 6 * * * Asia/Tokyo` is rejected as `INVALID_SCHEDULE`; timezone suffixes are not part of the current schema/contract. |
| `nextRunAt` | No current route/job/schema behavior calculates or persists `nextRunAt` for report subscriptions. |
| Month-end / year-crossing / DST | No current route/job/schema behavior evaluates calendar boundaries; operational cron frequency remains the scheduling control. |

## Run / delivery / failure matrix

| Flow | Current behavior preserved |
| --- | --- |
| Manual run dry-run | Builds payload and returns channels/recipients without creating delivery rows. |
| Email delivery | Creates a `pending` delivery row first, then claims it with `pending -> sending` before immediate send processing. |
| Dashboard delivery | Stores `success` when user/role targets exist; stores `skipped/missing_recipients` otherwise. |
| Missing email recipients | Stores `skipped/missing_email` for newly built email delivery data. |
| Delivery status aggregation | `lastRunStatus` becomes `success`, `queued`, `failed`, `partial`, or `skipped` from delivery result statuses. |
| Retry job ordering | Processes `pending` deliveries first by `createdAt asc`, then eligible `failed` deliveries by `nextRetryAt asc, createdAt asc`, with total `take=100`. |
| Retry claim lock | Claims `pending` with `status=pending` and `failed` with `retryCount < max` and `nextRetryAt <= now`; already-claimed rows return `skipped/already_claimed`. |
| Non-retryable or exhausted failure | Persists `failed_permanent`, clears `nextRetryAt`, records `lastErrorAt`, and triggers configured permanent failure notification when applicable. |

## Verification

| Command | Result |
| --- | --- |
| `npm ci --prefix packages/backend` | PASS |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run prisma:generate --prefix packages/backend` | PASS |
| `npm run lint --prefix packages/backend` | PASS after fixing a `no-useless-escape` regex lint issue |
| `npm run format:check --prefix packages/backend` | PASS |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run typecheck --prefix packages/backend` | PASS |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend` | PASS |
| `npm run arch:bounded-context --prefix packages/backend` | PASS: 225 modules / 882 dependencies / no violations |
| `npm run arch:bounded-context:coverage --prefix packages/backend` | PASS: source files 215 / target route-service files 204 / unclassified 0 / stale 0 / duplicate 0 |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test --prefix packages/backend -- test/reportSubscriptionRoutes.test.js test/coverageThresholds.test.js` | PASS: 34 tests |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend` | PASS: 1244 tests |
| `npm ci --prefix packages/frontend` | PASS: 481 packages, 0 vulnerabilities |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh` | PASS: 105 tests; Podman DB port auto-fallback 55433 -> 55437 |
| `git diff --check` | PASS |

## Coverage / gate state

- No coverage thresholds were lowered.
- No `skip` / `only` / `todo` tests were added.
- `coverageThresholds.test.js` now asserts `reportSubscriptions.ts` has no temporary `max-lines` allowance and remains under the default backend route gate.
- Bounded-context coverage includes `src/application/reportSubscriptions/**` as application-orchestration and reports zero unclassified files.

## Sakura VPS verification

- Not executed for this repository-side issue.
- #1903 remains independent. Local SSH config inspection did not identify a safe trial-only alias, so #1903 was updated separately and repository-side work continued without private-smoke execution.

## Residual risks

- `report_subscriptions.schedule` remains a stored five-field cron string only. Timezone-aware `nextRunAt` calculation is not implemented because current code/schema/docs do not define that behavior, and #1959 explicitly forbids guessing schedule/timezone/DST semantics.
- `useCases.ts` is below the default 1500-line gate but close to it (1463 lines). Future feature additions should split report payload generation and delivery retry ports before adding substantial logic.
