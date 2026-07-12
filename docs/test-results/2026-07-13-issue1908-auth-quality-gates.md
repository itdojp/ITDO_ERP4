# Issue #1908 Auth Quality Gates Verification

## Scope

Issue: [#1908](https://github.com/itdojp/ITDO_ERP4/issues/1908)

This record covers the auth route size gate and auth coverage gate hardening after the #1906/#1907 auth route split.

## Route size gate

Backend ESLint keeps the default route/module `max-lines` gate at 1500 lines. `packages/backend/eslint.config.cjs` has no auth-specific temporary allowance; the remaining temporary route allowances are unrelated legacy hotspots (`chatRooms`, `projects`, `chat`, `vendorDocs`, `reportSubscriptions`).

Current auth route/application line counts:

| File                                                             | Lines | Gate status                                                                      |
| ---------------------------------------------------------------- | ----: | -------------------------------------------------------------------------------- |
| `packages/backend/src/routes/auth.ts`                            |    32 | PASS: <= 1500                                                                    |
| `packages/backend/src/routes/auth/googleSessionRoutes.ts`        |   584 | PASS: <= 1500                                                                    |
| `packages/backend/src/routes/auth/http.ts`                       |   137 | PASS: <= 1500                                                                    |
| `packages/backend/src/routes/auth/localAuthRoutes.ts`            |   109 | PASS: <= 1500                                                                    |
| `packages/backend/src/routes/auth/localCredentialAdminRoutes.ts` |   128 | PASS: <= 1500                                                                    |
| `packages/backend/src/routes/auth/localIdentityHttp.ts`          |    98 | PASS: <= 1500                                                                    |
| `packages/backend/src/routes/auth/localIdentitySchemas.ts`       |   131 | PASS: <= 1500                                                                    |
| `packages/backend/src/routes/auth/userIdentityAdminRoutes.ts`    |   168 | PASS: <= 1500                                                                    |
| `packages/backend/src/application/auth/localIdentityShared.ts`   |   398 | PASS: <= 1500                                                                    |
| `packages/backend/src/application/auth/localIdentityUseCases.ts` |  1433 | PASS: <= 1500; review watch item because it is above the 800-line attention line |

`localIdentityUseCases.ts` is an application service rather than an auth route module. It remains below the enforced 1500-line gate, but it is intentionally documented as a future split/watch item because it is above the 800-line review attention line.

## Coverage scope

`packages/backend/coverage-thresholds.json` defines `auth.files` as the source of truth for `CI / coverage-auth`.

Current auth coverage scope:

- `src/plugins/auth.ts`
- `src/application/auth/localIdentityShared.ts`
- `src/application/auth/localIdentityUseCases.ts`
- `src/routes/auth.ts`
- `src/routes/auth/googleSessionRoutes.ts`
- `src/routes/auth/http.ts`
- `src/routes/auth/localAuthRoutes.ts`
- `src/routes/auth/localCredentialAdminRoutes.ts`
- `src/routes/auth/localIdentityHttp.ts`
- `src/routes/auth/localIdentitySchemas.ts`
- `src/routes/auth/userIdentityAdminRoutes.ts`
- `src/services/authContext.ts`
- `src/services/authGateway.ts`
- `src/services/envValidation.ts`
- `src/services/localCredentials.ts`
- `src/utils/authGroupToRoleMap.ts`

Completeness / stale-entry controls:

- `packages/backend/test/coverageThresholds.test.js` reconstructs expected auth files from:
  - `src/routes/auth/*.ts`
  - `src/application/auth/*.ts`
  - required auth plugin/service/utility files
- The same test verifies all configured coverage files exist on disk.
- `packages/backend/scripts/check-coverage-thresholds.mjs` now fails before threshold aggregation when `coverage-thresholds.json` contains a stale/nonexistent file.

## Coverage baseline and thresholds

Measured with `npm run coverage:auth:check --prefix packages/backend` after adding direct `authContext` coverage and auth scope completeness checks.

| Metric     | #1908 measured baseline | Configured threshold | Previous threshold | Result |
| ---------- | ----------------------: | -------------------: | -----------------: | ------ |
| statements |                  89.72% |               89.70% |             25.00% | PASS   |
| branches   |                  70.56% |               70.50% |             60.00% | PASS   |
| functions  |                  97.99% |               97.90% |             18.00% | PASS   |
| lines      |                  89.72% |               89.70% |             25.00% | PASS   |

The configured thresholds are rounded down to one decimal place from the measured baseline. No auth source file was removed from the coverage scope to raise the aggregate.

## Negative tests

The following negative checks were executed locally and failed as expected:

| Negative condition                                                | Expected failure                                                                                              | Evidence                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Add an auth route probe file with 1501 lines                      | `npm run lint --prefix packages/backend` fails with `File has too many lines (1501). Maximum allowed is 1500` | `.codex-local/tmp/issue1908-negative-tests-20260712T202218+0900.log` |
| Remove `src/routes/auth/localAuthRoutes.ts` from `auth.files`     | `coverageThresholds.test.js` fails the auth scope completeness assertion                                      | `.codex-local/tmp/issue1908-negative-tests-20260712T202218+0900.log` |
| Add stale `src/routes/auth/staleRemovedRoute.ts` to `auth.files`  | coverage checker fails with `coverage configured file does not exist`                                         | `.codex-local/tmp/issue1908-negative-tests-20260712T202218+0900.log` |
| Force major auth coverage regression in a copied coverage summary | `check-coverage-thresholds.mjs --scope auth` fails statements/branches/functions/lines                        | `.codex-local/tmp/issue1908-negative-tests-20260712T202218+0900.log` |

## Independent review

A read-only `security_reviewer` subagent inspected the diff before PR publication. Conclusion: no blocking security finding; the change is limited to auth quality gates, completeness tests, coverage thresholds, and documentation, and it does not weaken auth runtime behavior, secrets handling, cookie, CSRF, rate-limit, or authorization boundaries.

Reviewer-noted residual risks:

- PR-based review and review-thread completeness must still be checked after publication.
- Future auth logic moved to nested directories or new `src/services/*` files must update both `auth.files` and the completeness test in the same PR.
- `src/application/auth/localIdentityUseCases.ts` remains below the 1500-line gate but above the 800-line attention line, so it should remain a future split/watch item.

## Local verification

The evidence paths in the table below are local-only raw logs under `.codex-local/tmp/`; they are not committed repository artifacts. This Markdown file is the PR-visible evidence summary, and the GitHub Actions checks on the PR are the remote canonical verification evidence.

| Check                                                                                                                                                                                                                       | Result                    | Evidence                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `npm ci --prefix packages/backend`                                                                                                                                                                                          | PASS                      | `.codex-local/tmp/issue1908-npm-ci-20260712T201649+0900.log`                     |
| Baseline `npm run coverage:auth:check --prefix packages/backend` before #1908 threshold raise                                                                                                                               | PASS                      | `.codex-local/tmp/issue1908-baseline-coverage-20260712T201708+0900.log`          |
| Targeted build/tests/auth coverage after adding tests                                                                                                                                                                       | PASS                      | `.codex-local/tmp/issue1908-after-tests-coverage-20260712T202003+0900.log`       |
| Negative tests listed above                                                                                                                                                                                                 | PASS as expected failures | `.codex-local/tmp/issue1908-negative-tests-20260712T202218+0900.log`             |
| Final backend verification: Prisma generate, build, targeted tests, auth coverage, lint, format, changed-file Prettier check, bounded-context, docs index, doc image links, full backend test suite, and `git diff --check` | PASS                      | `.codex-local/tmp/issue1908-final-backend-verify-rerun-20260713T050029+0900.log` |
| Core E2E: `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                                                                                                          | PASS: 105 tests           | `.codex-local/tmp/issue1908-e2e-core-20260713T050331+0900.log`                   |

An earlier final backend verification attempt at `.codex-local/tmp/issue1908-final-backend-verify-20260713T045940+0900.log` failed at build because `npm ci` removed the generated Prisma client and the script did not run `prisma:generate` before `tsc`. The rerun above explicitly included `npm run prisma:generate --prefix packages/backend` before build and passed.

## Conditional Sakura VPS / HTTPS trial checks

The issue defines Sakura VPS private-smoke and Google HTTPS trial checks as conditional:

- #1903 remains open and requires real Sakura VPS runtime inputs.
- #1904 remains open and requires the HTTPS/Google login trial environment.

Therefore this verification does not claim Sakura VPS or production Google OAuth success. The PR validation is limited to local/CI build, tests, coverage, lint, bounded-context, and core E2E.
