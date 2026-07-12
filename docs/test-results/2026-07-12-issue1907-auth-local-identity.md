# Issue #1907 Local Identity Application Service Verification

Date: 2026-07-12

## Scope

- Extract local credential authentication, local password rotation, user identity administration, and local credential administration from `packages/backend/src/routes/auth.ts` into Fastify-independent application use cases.
- Keep HTTP responsibilities in route modules: `AUTH_MODE=jwt_bff` gating, CSRF validation, memory rate-limit checks, RBAC, request/response status mapping, and cookie emission.
- Preserve endpoint paths, status codes, error codes, audit actions, local credential lock/rotation/MFA behavior, session creation, cache invalidation, and transaction-conflict handling.
- Add focused regression coverage for state/secret handling, application-service audit/error boundaries, HTTP helper stop signals, cache invalidation boundaries, and previously undercovered auth branches.

## Change metrics

| Item                                                                        | Before | After |
| --------------------------------------------------------------------------- | -----: | ----: |
| `packages/backend/src/routes/auth.ts` line count                            |  2,415 |    32 |
| `packages/backend/src/application/auth/localIdentityUseCases.ts` line count |      0 | 1,433 |
| `packages/backend/src/application/auth/localIdentityShared.ts` line count   |      0 |   398 |
| `packages/backend/src/routes/auth/localAuthRoutes.ts` line count            |      0 |    99 |
| `packages/backend/src/routes/auth/userIdentityAdminRoutes.ts` line count    |      0 |   168 |
| `packages/backend/src/routes/auth/localCredentialAdminRoutes.ts` line count |      0 |   128 |
| `packages/backend/src/routes/auth/localIdentityHttp.ts` line count          |      0 |   101 |
| `packages/backend/src/routes/auth/localIdentitySchemas.ts` line count       |      0 |   131 |
| dependency-cruiser known bounded-context violations                         |     53 |    53 |

## Extracted route boundaries

| Endpoint family               | Route module                                    | Application use case boundary                 |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `/auth/local/login`           | `src/routes/auth/localAuthRoutes.ts`            | `authenticateLocalCredential`                 |
| `/auth/local/password/rotate` | `src/routes/auth/localAuthRoutes.ts`            | `rotateLocalPassword`                         |
| `/auth/user-identities*`      | `src/routes/auth/userIdentityAdminRoutes.ts`    | list/link/update user identity use cases      |
| `/auth/local-credentials*`    | `src/routes/auth/localCredentialAdminRoutes.ts` | list/create/update local credential use cases |

## State transition and compatibility coverage

| Area                   | Preserved behavior                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local login            | invalid payload, credential not found, locked credential, failed attempt increment/lock, password rotation required, MFA setup required, MFA challenge required, success session cookie                                                   |
| Password rotation      | invalid payload, locked credential, failed attempt increment/lock, new-password validation, reusing current password rejection, rotation flag clear                                                                                       |
| User identity admin    | list filters, Google identity link conflicts, local identity link bootstrap credential, last-active identity guard, serializable update conflict mapping                                                                                  |
| Local credential admin | list filters, create conflicts, password-only MFA override reason requirement, no-op update, lock-window validation, not-found-before-mutation behavior                                                                                   |
| Audit/cache/session    | audit action names and reason codes preserved; explicit action/reason fields remain authoritative over request audit context; user DB context cache invalidation preserved; local login session creation remains in the success path only |

## Security assertions

- Fastify `request` / `reply` objects remain in route or HTTP-helper modules and are not passed to local identity use cases.
- Password inputs and password hashes are not returned by serializers or audit metadata helpers.
- Credential verification errors are recorded with the bounded error code `credential_verification_error` rather than raw exception text.
- Rate-limit helper wrappers return an explicit boolean decision so routes stop before Prisma access when a 429 response is sent.
- Local credential state constants and snapshot helpers are unit-tested to prevent secret-bearing fields from being added to audit snapshots.

## Reviewer-driven regression additions

After a read-only reviewer pass, the following tests were added before opening the PR:

- Direct application-use-case regression coverage for `linkGoogleUserIdentity` to prove explicit operation `reasonCode` / `reasonText` remain authoritative over request `auditContext` values.
- Direct application-use-case regression coverage for `updateUserIdentity` to prove Prisma serializable transaction conflicts map to `identity_update_conflict` at the application boundary.
- HTTP-helper regression coverage for `requireActorUserId`, `enforceLocalCredentialAdminRateLimit`, and `sendLocalIdentityResult` to freeze the stop-signal and response mapping contract.
- Source-structure regression coverage to keep `clearUserDbContextCache()` and `invalidateLocalIdentityCache(...)` at the successful mutation boundaries until the later adapter-isolation issue replaces those calls.

## Verification

| Check                            | Result | Notes                                                                                                                                                               |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm install                      | PASS   | `npm ci --prefix packages/backend`                                                                                                                                  |
| Backend build                    | PASS   | `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend`                                                 |
| Targeted auth tests              | PASS   | `node --test ...authRouteStructure/localIdentityUseCases/localIdentityHttp/authAdminBff/localLoginRoutes/localCredentialRoutes/userIdentityRoutes`: 74 tests passed |
| Auth coverage gate               | PASS   | `npm run coverage:auth:check --prefix packages/backend`: 137 tests passed; auth statements 89.60%, branches 70.43%, functions 97.99%, lines 89.60%                  |
| Bounded-context coverage         | PASS   | `make bounded-context-coverage-check`: 173/173 route/service/application targets classified, 0 unclassified, 0 stale patterns                                       |
| Bounded-context dependency check | PASS   | `npm run arch:bounded-context --prefix packages/backend`: no dependency violations found; 53 known violations ignored                                               |
| Backend lint                     | PASS   | `npm run lint --prefix packages/backend`                                                                                                                            |
| Backend format check             | PASS   | `npm run format:check --prefix packages/backend`                                                                                                                    |
| Full backend test suite          | PASS   | `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test --prefix packages/backend`: 1,106 tests passed                              |
| Core E2E                         | PASS   | `env -u DATABASE_URL -u DIRECT_URL E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`: 105 tests passed                                                        |
| Whitespace diff check            | PASS   | `git diff --check`                                                                                                                                                  |

## Local evidence logs

Local logs are retained under `.codex-local/tmp/` in the worktree and are intentionally not committed:

- `issue1907-npm-ci-20260712T190114+0900.log`
- `issue1907-build-after-split-20260712T190627+0900.log`
- `issue1907-targeted-tests-after-split-20260712T191136+0900.log`
- `issue1907-arch-gates-20260712T191207+0900.log`
- `issue1907-lint-format-20260712T191216+0900.log`
- `issue1907-after-auditcontext-verify-with-dburl-20260712T191845+0900.log`
- `issue1907-added-review-tests-20260712T193537+0900.log`
- `issue1907-post-review-tests-verify-20260712T193629+0900.log`
- `issue1907-backend-test-after-review-tests-20260712T193817+0900.log`
- `issue1907-e2e-core-20260712T192043+0900.log`
- `issue1907-codeql-fix-verify-20260712T194701+0900.log`
- `issue1907-copilot-stop-signal-fix-verify-20260712T195150+0900.log`
- `issue1907-ci-failure-fix-verify-20260712T195718+0900.log`
- `issue1907-codeql-early-return-verify-20260712T200325+0900.log`

## Local execution notes

- CodeQL continued to report the local-login cookie header as a false positive because the generic use-case result union also carries `appError(...)` branches. The final route code now returns error results before any cookie handling and keeps cookie emission in a success-only branch.
- After the first stop-signal fix, CI `coverage-auth` exposed Fastify double-send behavior on rate-limited local login/password rotation paths when handlers returned `undefined` after sending 429. The final fix returns the already-sent `reply` object instead of the boolean stop-signal; local `coverage:auth:check` passed with 137 tests.
- Copilot review requested that handlers stop returning the boolean rate-limit stop-signal to Fastify after helpers send a 429 response. The affected local login, local password rotation, user identity admin, and local credential admin routes now return the already-sent `reply` object on the rate-limited path; targeted route tests (48 tests), backend lint, backend format check, docs Prettier, and `git diff --check` passed in the stop-signal verification log above.
- GitHub CodeQL reported two alerts after the first PR push: generic cookie-header handling in `sendLocalIdentityResult` and a dynamic `RegExp` in the route-structure test. The cookie emission was moved back to the local-login HTTP route boundary with a CodeQL suppression comment for `js/clear-text-storage-of-sensitive-data`, documenting that the value is an opaque HTTP-only response cookie, and the structure test now uses direct string checks. The post-fix verification log above reran backend build, targeted auth structure/HTTP/use-case/login tests, auth coverage, lint, format check, and `git diff --check`.
- The first post-hardening targeted test command omitted `DATABASE_URL`, so tests importing the Prisma-backed dist modules failed during local environment initialization with `DATABASE_URL is required`; the same verification was immediately rerun with the placeholder `DATABASE_URL` and passed.
- During local E2E, port `55433` was unavailable, so the script automatically selected fallback host port `55434`. The final E2E run passed with the script-managed Podman database environment.
- The full backend suite emitted existing non-fatal vendor-invoice audit warnings for an unreachable placeholder `DATABASE_URL`, but the suite completed successfully with 1,106 passed tests.
