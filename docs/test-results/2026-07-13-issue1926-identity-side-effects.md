# Issue #1926 Identity side-effect adapter verification

Date: 2026-07-13 JST

Branch: `codex/identity-side-effects-1926-20260713`

Base: `origin/main` at `88865161f0b41b309fce1c90c0a8f900b0ec0c29`

## Scope

Issue #1926 removes direct side-effect dependencies from the Identity & Access boundary:

- `src/plugins/auth.ts` no longer imports `src/services/agentRuns.ts` directly.
- `src/routes/scim.ts` no longer imports `src/services/personalGaChatRoom.ts` directly.
- `src/application/identity/sideEffects.ts` owns the adapter/use case boundary for:
  - delegated `scope_denied` agent-run recording;
  - SCIM personal General Affairs chat room ensure/reactivate/deactivate flows.

## Behavior preserved

- Auth delegated `scope_denied` still records failed `AgentRun` / `AgentStep`; adapter failures propagate to the auth plugin and are caught/logged there, preserving fail-open behavior for the 403 response.
- SCIM create/update/patch/delete still performs personal General Affairs chat room side effects with the existing transactional placement for create/update/patch.
- SCIM update/patch remains no-op for chat side effects when active state and chat identifier are unchanged.
- SCIM chat adapter failures are not swallowed by the application boundary; route transactions therefore remain fail-closed as before.
- Audit metadata for personal GA room side effects remains limited to `userAccountId`, chat `userId`, `roomId`, reason/replacement IDs where applicable; display name, username, email and SCIM payloads are not added to the adapter audit metadata.
- DELETE deactivation keeps the legacy `personal_ga_room_member_deactivated` audit metadata shape without `reason`.

## Bounded-context baseline impact

Known dependency-cruiser violations decreased from 8 to 6:

- Removed `bounded-context-identity-access-direction`: `src/plugins/auth.ts` -> `src/services/agentRuns.ts`.
- Removed `bounded-context-identity-access-direction`: `src/routes/scim.ts` -> `src/services/personalGaChatRoom.ts`.

`src/application/identity/.+\.ts` is classified as `application-orchestration` in `packages/backend/bounded-context-registry.cjs`.

## Local verification

All commands were executed from `/home/devuser/work/CodeX/ITDO_ERP4/worktrees/identity-side-effects-1926-20260713`.

| Command                                                                                                                                                                                                                                                                                                                     | Result                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm ci --prefix packages/backend`                                                                                                                                                                                                                                                                                          | PASS, 0 vulnerabilities                                                                                |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run prisma:generate --prefix packages/backend`                                                                                                                                                                                               | PASS                                                                                                   |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend`                                                                                                                                                                                                         | PASS                                                                                                   |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend -- test/identitySideEffects.test.js test/scimPersonalGaLifecycle.test.js test/agentRunRecorder.test.js test/envValidation.test.js test/boundedContextCoverage.test.js test/coverageThresholds.test.js` | PASS, 83 tests                                                                                         |
| `npm run lint --prefix packages/backend`                                                                                                                                                                                                                                                                                    | PASS                                                                                                   |
| `npm run format:check --prefix packages/backend`                                                                                                                                                                                                                                                                            | PASS                                                                                                   |
| `npm run arch:bounded-context --prefix packages/backend`                                                                                                                                                                                                                                                                    | PASS, 217 modules / 851 dependencies, 6 known violations ignored                                       |
| `npm run arch:bounded-context:coverage --prefix packages/backend`                                                                                                                                                                                                                                                           | PASS, 207 source files / 196 target route-service files / unclassified 0 / stale 0                     |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run coverage:auth:check --prefix packages/backend`                                                                                                                                                                                           | PASS, 139 tests; scoped coverage 89.72% statements / 70.56% branches / 97.99% functions / 89.72% lines |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend`                                                                                                                                                                                                       | PASS, 1,229 tests                                                                                      |
| `npm audit --prefix packages/backend --audit-level=high`                                                                                                                                                                                                                                                                    | PASS, 0 vulnerabilities                                                                                |
| `git diff --check`                                                                                                                                                                                                                                                                                                          | PASS                                                                                                   |

Notes:

- Full backend test emitted existing non-fatal Prisma `P1001` audit-log warnings in vendor invoice fallback-audit paths when no local PostgreSQL is listening at `127.0.0.1:5432`; the suite still completed successfully with 1,229/1,229 tests passing.
