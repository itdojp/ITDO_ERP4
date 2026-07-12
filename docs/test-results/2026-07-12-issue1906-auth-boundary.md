# Issue #1906 Auth Boundary Refactor Verification

Date: 2026-07-12

## Scope

- Split Google BFF, session, CSRF, and logout route registration out of `packages/backend/src/routes/auth.ts` into `packages/backend/src/routes/auth/googleSessionRoutes.ts`.
- Extract shared HTTP-boundary helpers for auth gateway mode checks, CSRF validation, and rate-limit enforcement into `packages/backend/src/routes/auth/http.ts`.
- Preserve existing endpoint paths, status/error codes, cookie and CSRF behavior, redirect behavior, session revoke/logout behavior, and rate-limit behavior.
- Keep local login, local credential administration, and user identity administration in `auth.ts` for later #1900 child issues.

## Change metrics

| Item                                                                 | Before | After |
| -------------------------------------------------------------------- | -----: | ----: |
| `packages/backend/src/routes/auth.ts` line count                     |  3,087 | 2,415 |
| `packages/backend/src/routes/auth/googleSessionRoutes.ts` line count |      0 |   584 |
| `packages/backend/src/routes/auth/http.ts` line count                |      0 |   137 |
| auth route temporary max-lines cap                                   |  3,150 | 2,500 |
| dependency-cruiser known bounded-context violations                  |     53 |    53 |

## Verification

| Check                            | Result | Notes                                                                                                                                         |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma generate                  | PASS   | `npx --prefix packages/backend prisma generate --config packages/backend/prisma.config.ts`                                                    |
| Backend build                    | PASS   | `npm run build --prefix packages/backend`                                                                                                     |
| Bounded-context coverage         | PASS   | `make bounded-context-coverage-check`: 166/166 route/service targets classified, 0 unclassified, 0 stale patterns                             |
| Bounded-context dependency check | PASS   | `npm run arch:bounded-context --prefix packages/backend`: no new violations; 53 known violations ignored                                      |
| Backend lint                     | PASS   | `npm run lint --prefix packages/backend`                                                                                                      |
| Backend format check             | PASS   | `npm run format:check --prefix packages/backend`                                                                                              |
| Targeted auth tests              | PASS   | `node --test packages/backend/test/authGatewayRoutes.test.js packages/backend/test/authRouteStructure.test.js`: 29 tests passed               |
| Auth coverage gate               | PASS   | `npm run coverage:auth:check --prefix packages/backend`: 124 tests passed; statements 85.64%, branches 68.40%, functions 97.62%, lines 85.64% |
| Full backend test suite          | PASS   | `npm run test --prefix packages/backend`: 1,093 tests passed                                                                                  |
| Core E2E                         | PASS   | `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`: 105 tests passed                                                                    |
| Whitespace diff check            | PASS   | `git diff --check`                                                                                                                            |

## Security and compatibility assertions

- Fastify request/reply objects remain at the route or HTTP-helper boundary and are not passed into auth service code.
- Google token exchange errors no longer embed upstream response bodies in thrown error messages.
- Regression coverage verifies that failed Google token exchange audit metadata contains the status-only code `google_token_exchange_failed:400` and does not include upstream `invalid_grant`, authorization code, or client secret values.
- `AUTH_MODE=header` coverage verifies that moved Google/session endpoints continue to return the auth-gateway-disabled `404/not_found` response.
- A route-structure test verifies that Google/session endpoint registration moved out of `auth.ts` and remains present in `googleSessionRoutes.ts`.

## Local execution notes

- During local E2E, port `55433` was unavailable, so the script automatically selected a fallback Podman PostgreSQL host port. The final E2E run passed with the script-managed database environment.
- The full backend suite emitted existing non-fatal vendor-invoice audit warnings for an unreachable placeholder `DATABASE_URL`, but the suite completed successfully with 1,093 passed tests.
