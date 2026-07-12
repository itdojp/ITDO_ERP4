# Issue #1911 Chat route split and quality gate verification

## Scope

Issue: [#1911](https://github.com/itdojp/ITDO_ERP4/issues/1911)

This change verifies that `packages/backend/src/routes/chatRooms.ts` is below the default backend `max-lines` gate and that the chat backend slice has an explicit coverage gate in the existing required `CI / backend` job.

## Implementation summary

- Split chat room message/AI summary/ack-request route registration from `src/routes/chatRooms.ts` into `src/routes/chatRooms/messages.ts`.
- Moved common room access helpers used by the split route module into `src/routes/chatRooms/shared.ts`.
- Removed the temporary ESLint `max-lines` allowance for `src/routes/chatRooms.ts`; it now uses the default backend limit of 1500 effective lines.
- Added `coverage:chat` and `coverage:chat:check` in `packages/backend/package.json`.
- Added the `chat` scope in `packages/backend/coverage-thresholds.json` and wired `npm run coverage:chat:check` into the existing `CI / backend` job.
- Added `coverageThresholds.test.js` coverage scope tests for chat top-level routes, route modules, chat services, chat application effects, and the default notification adapter.
- Updated quality/refactoring documentation to describe the new chat gate and current route status.

## Line-count evidence

| File                                                | Lines | Gate status                                |
| --------------------------------------------------- | ----: | ------------------------------------------ |
| `packages/backend/src/routes/chatRooms.ts`          |  1228 | PASS: below default 1500-line backend gate |
| `packages/backend/src/routes/chatRooms/messages.ts` |   824 | PASS: below default 1500-line backend gate |
| `packages/backend/src/routes/chatRooms/shared.ts`   |    42 | PASS: below default 1500-line backend gate |

`src/routes/chatRooms.ts` had a temporary cap of 2100 after #1910. This PR removes that allowance.

## Chat coverage baseline

`coverage:chat:check` uses `coverage/chat/coverage-summary.json` but re-aggregates only files listed in `coverage-thresholds.json#chat.files`. This prevents unrelated backend files from changing the chat gate denominator.

| Metric     | Measured configured-file coverage | Threshold |
| ---------- | --------------------------------: | --------: |
| statements |                            53.45% |    53.40% |
| branches   |                            59.41% |    59.40% |
| functions  |                            70.13% |    70.10% |
| lines      |                            53.45% |    53.40% |

The lower whole-repository c8 summary printed by `coverage:chat` is not the gate value. The gate value is the configured-file aggregate printed by `scripts/check-coverage-thresholds.mjs --scope chat`.

## Negative checks

The following local negative checks were executed and failed as expected. They were restored before committing; raw logs are local-only under `.codex-local/tmp` and are not PR-visible artifacts.

| Negative check                                                                                      | Expected result           | Observed result                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| Append code lines to make `chatRooms.ts` exceed 1500 effective lines, then run backend lint         | `max-lines` failure       | PASS: lint exited non-zero and reported `Maximum allowed is 1500` |
| Remove `src/routes/chatRooms/messages.ts` from `chat.files`, then run the chat completeness test    | completeness test failure | PASS: `coverageThresholds.test.js` failed as expected             |
| Run narrow chat coverage with only `chatAckLinkTargets.test.js`, then check current chat thresholds | threshold failure         | PASS: checker reported `coverage threshold failed for chat`       |
| Add stale `src/routes/chatRooms/removedRoomRoute.ts` to chat coverage config, then run checker      | stale entry failure       | PASS: checker reported `coverage configured file does not exist`  |

## Verification

| Check                              | Command                                                                                                                           | Result                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Chat coverage gate                 | `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run coverage:chat:check --prefix packages/backend` | PASS: 133 tests, configured chat coverage thresholds passed                         |
| Coverage threshold structure tests | `node --test packages/backend/test/coverageThresholds.test.js`                                                                    | PASS: 12 tests                                                                      |
| Backend build                      | `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend`               | PASS                                                                                |
| Backend lint                       | `npm run lint --prefix packages/backend`                                                                                          | PASS                                                                                |
| Backend format                     | `npm run format:check --prefix packages/backend`                                                                                  | PASS                                                                                |
| Bounded context                    | `npm run arch:bounded-context --prefix packages/backend`                                                                          | PASS: 48 known violations ignored                                                   |
| Bounded context coverage           | `npm run arch:bounded-context:coverage --prefix packages/backend`                                                                 | PASS: 191 source files, 180 route/service target files, 0 unclassified              |
| Docs index unit test               | `node --test scripts/check-test-results-index.test.mjs`                                                                           | PASS: 2 tests                                                                       |
| Docs index check                   | `node scripts/check-test-results-index.mjs`                                                                                       | PASS after README index update                                                      |
| Doc image links                    | `node scripts/check-doc-image-links.mjs`                                                                                          | PASS: 115 image links in 309 markdown files                                         |
| Full backend test suite            | `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend`             | PASS: 1138 tests; existing non-fatal vendor invoice audit `P1001` warnings observed |
| Backend audit                      | `npm audit --prefix packages/backend --audit-level=high`                                                                          | PASS: 0 vulnerabilities                                                             |
| Core E2E                           | `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                          | PASS: 105 tests; Podman port fallback 55433 -> 55437                                |
| Diff whitespace                    | `git diff --check`                                                                                                                | PASS                                                                                |

## Residual notes

- `src/routes/chat.ts` still has a temporary ESLint cap of 1650 and remains a separate follow-up target. This issue intentionally does not remove the `chat.ts` allowance.
- The chat coverage gate establishes the current baseline; later chat route/service work should raise the thresholds when additional behavior is covered.
- Local raw logs are intentionally not committed. The PR-visible evidence is this Markdown file plus GitHub Actions results.
