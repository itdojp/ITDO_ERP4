# Issue #1958 Chat route split verification

## Scope

Issue #1958 removes the temporary backend `max-lines` allowance for `src/routes/chat.ts` by splitting chat acknowledgement and attachment responsibilities while preserving existing API, RBAC, audit, attachment scan/storage, and notification semantics.

## Implementation summary

- Split acknowledgement routes from `packages/backend/src/routes/chat.ts` into `packages/backend/src/routes/chat/ackRequests.ts`.
- Split attachment upload/download routes into `packages/backend/src/routes/chat/attachments.ts`.
- Moved attachment scan / store / DB create / audit orchestration into Fastify-independent `packages/backend/src/application/chat/chatAttachmentUseCases.ts`.
- Removed `src/routes/chat.ts` from the temporary backend `max-lines` ESLint allowance.
- Added the new chat route/application files to `packages/backend/coverage-thresholds.json#chat.files` without lowering thresholds.
- Added regression tests that keep chat route/application modules within the default 1500-line gate and prevent re-adding a `src/routes/chat.ts` temporary allowance.

## Line count evidence

| File                                                              | Lines |
| ----------------------------------------------------------------- | ----: |
| `packages/backend/src/routes/chat.ts`                             |   738 |
| `packages/backend/src/routes/chat/ackRequests.ts`                 |   649 |
| `packages/backend/src/routes/chat/attachments.ts`                 |   217 |
| `packages/backend/src/application/chat/chatAttachmentUseCases.ts` |   156 |

Temporary backend route max-lines allowances after this change:

| Allowance                           |  Cap |
| ----------------------------------- | ---: |
| `src/routes/reportSubscriptions.ts` | 1600 |

## Coverage gate

`coverage:chat:check` configured-file aggregate:

| Metric     | Result | Threshold |
| ---------- | -----: | --------: |
| Statements | 54.18% |    53.40% |
| Branches   | 59.52% |    59.40% |
| Functions  | 70.89% |    70.10% |
| Lines      | 54.18% |    53.40% |

## Verification

| Command                                                                                                                                                                                                                                         | Result | Notes                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run typecheck --prefix packages/backend`                                                                                                                         | PASS   | TypeScript compile check                                                           |
| `npm run lint --prefix packages/backend`                                                                                                                                                                                                        | PASS   | Includes default `max-lines` gate                                                  |
| `npm run format:check --prefix packages/backend`                                                                                                                                                                                                | PASS   | Prettier check                                                                     |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend`                                                                                                                             | PASS   | Backend build                                                                      |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test --prefix packages/backend -- test/chatAttachmentUploadRoutes.test.js test/chatAckRecipientPreview.test.js test/projectChatLegacyRoomResolution.test.js` | PASS   | 21 focused tests                                                                   |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test --prefix packages/backend -- test/coverageThresholds.test.js`                                                                                           | PASS   | Chat coverage scope, threshold, line gate, no-allowance regression                 |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run coverage:chat:check --prefix packages/backend`                                                                                                               | PASS   | 133 tests; configured chat coverage thresholds passed                              |
| `npm run arch:bounded-context --prefix packages/backend`                                                                                                                                                                                        | PASS   | 224 modules / 881 dependencies cruised; no violations                              |
| `npm run arch:bounded-context:coverage --prefix packages/backend`                                                                                                                                                                               | PASS   | 214 source files; 0 unclassified / invalid / stale / duplicate / ambiguous entries |
| `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test --prefix packages/backend`                                                                                                                              | PASS   | 1239 backend tests                                                                 |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                                                                                                                                        | PASS   | 105 Playwright core E2E tests; Podman DB port fell back from 55433 to 55434        |
| `git diff --check`                                                                                                                                                                                                                              | PASS   | No whitespace errors                                                               |

## Compatibility notes

- The public route paths and status/error codes were preserved.
- Attachment AV failure (`AV_UNAVAILABLE`), infected-file handling (`VIRUS_DETECTED`), scan audit events, and storage provider selection remain unchanged.
- The route layer still performs HTTP/RBAC/room-access checks; attachment scan/store/DB/audit orchestration is now handled by a Fastify-independent application use case.
- No coverage threshold was lowered and no test skip/only/todo or coverage ignore was introduced.
