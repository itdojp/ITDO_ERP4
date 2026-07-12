# Issue #1910 Chat notification port / application effects verification

## Scope

- Issue: [#1910 arch(chat): message・ack・通知連携をapplication service / event境界へ移す](https://github.com/itdojp/ITDO_ERP4/issues/1910)
- Worktree: `worktrees/chat-event-boundary-1910-20260713`
- Branch: `codex/chat-event-boundary-1910-20260713`
- Objective: Chat route/service から Notifications 実装 (`services/appNotifications.ts`) への直接 import を削減し、message / mention / ack required 通知を application-level port 境界へ移す。

## Boundary change

### Before

```text
routes/chat.ts ---------------------------> services/appNotifications.ts
routes/chatRooms.ts ----------------------> services/appNotifications.ts
services/chatAckNotifications.ts --------> services/appNotifications.ts
services/chatAckReminders.ts ------------> services/appNotifications.ts
services/chatRoomAclAlerts.ts -----------> services/appNotifications.ts
```

- `dependency-cruiser-known-violations.json` baseline: 53 entries
- Chat -> Notifications implementation direct baseline entries: 5

### After

```text
routes/chat.ts
routes/chatRooms.ts
services/chatAckNotifications.ts
services/chatAckReminders.ts
services/chatRoomAclAlerts.ts
  -> application/chat/chatNotificationPort.ts
  -> adapters/notifications/chatNotificationAdapter.ts
  -> services/appNotifications.ts
```

- `dependency-cruiser-known-violations.json` baseline: 48 entries
- Removed direct Chat -> `services/appNotifications.ts` entries: 5
- Remaining `appNotifications.ts` import in this slice is isolated to `adapters/notifications/chatNotificationAdapter.ts`.
- `application/chat/*` and `adapters/notifications/*` are classified in `bounded-context-registry.cjs`.

## Message / ack / notification order and failure policy

| Flow                       | Existing-compatible order after this change                                                                                                                                      | Notification failure policy                                                        | Notes                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Project message post       | create `chatMessage` -> mention audit -> mention notification effect -> all-post notification effect -> return message                                                           | fail-open; warning log only                                                        | Mention recipients are excluded from all-post notifications as before.                                     |
| Room message post          | create `chatMessage` -> mention audit when mentions exist -> mention notification effect -> all-post notification effect -> return message or existing post-without-view warning | fail-open; warning log only                                                        | Room audience expansion remains in `chatMentionRecipients.ts`; route no longer owns notification creation. |
| Project ack request        | create message + `ackRequest` -> ack request audit -> mention audit -> mention notification effect -> ack-required notification effect -> return message                         | fail-open for notification effects; audit write remains best-effort via `logAudit` | Existing status/error behavior is unchanged.                                                               |
| Room ack request           | create message + `ackRequest` -> ack request audit -> ack-required notification effect -> mention audit when mentions exist -> return message                                    | fail-open for ack-required notification effect                                     | Existing room ack mention-notification behavior is not broadened.                                          |
| Ack reminders / ACL alerts | resolve candidates -> `ChatNotificationPort.filterRecipients` -> create reminder/alert notifications                                                                             | existing suppression/bypass rules preserved by adapter                             | Direct `filterNotificationRecipients` import is removed from Chat services.                                |

## Payload minimization

- `ChatNotificationPort` events carry `messageExcerpt` only, not full `messageBody`.
- The excerpt normalization is `messageBody.replace(/\s+/g, ' ').trim().slice(0, 140)`, matching existing `appNotifications.ts` payload behavior.
- The default adapter maps `messageExcerpt` to the legacy `messageBody` parameter expected by `appNotifications.ts`; persisted notification payload remains the existing excerpt-only shape.

## Route size / gate update

| File                                       |  Before this slice | After this slice |      Gate change |
| ------------------------------------------ | -----------------: | ---------------: | ---------------: |
| `packages/backend/src/routes/chat.ts`      | 1750 temporary cap |       1592 lines | cap 1750 -> 1650 |
| `packages/backend/src/routes/chatRooms.ts` | 2250 temporary cap |       2064 lines | cap 2250 -> 2100 |

## Tests and verification

### Implemented tests

- `packages/backend/test/chatAckNotificationsPort.test.js`
  - injected notification port is used for ack-required notification creation
  - ack-required notification creation remains fail-open
- `packages/backend/test/chatNotificationEffects.test.js`
  - mention notification effect emits excerpt-only port event and logs audit
  - mention notification effect remains fail-open when notification backend fails
  - message notification effect resolves audience and excludes mention recipients

### Local commands

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node --test \
  packages/backend/test/chatAckNotificationsPort.test.js \
  packages/backend/test/chatNotificationEffects.test.js \
  packages/backend/test/chatAckReminders.test.js \
  packages/backend/test/chatMentionNotifications.test.js \
  packages/backend/test/notificationSuppressionRules.test.js
cd packages/backend && DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public node scripts/run-tests.js \
  test/chatAckLinksRoutes.test.js \
  test/chatAckTemplatesRoutes.test.js \
  test/chatAckRecipientPreview.test.js \
  test/chatAckRecipientResolution.test.js \
  test/chatAckRecipients.test.js \
  test/chatRoomsPostAccessControl.test.js \
  test/chatRoomsMentionCandidatesProjectRoom.test.js \
  test/chatRoomAccess.test.js \
  test/chatRoomAccessError.test.js \
  test/chatMentionCandidatesService.test.js \
  test/chatMentionRecipients.test.js \
  test/chatMentionsNormalizer.test.js \
  test/chatReadState.test.js \
  test/chatExternalLlm.test.js
npm run arch:bounded-context --prefix packages/backend
npm run arch:bounded-context:coverage --prefix packages/backend
npm run lint --prefix packages/backend
npm run format:check --prefix packages/backend
node --test scripts/check-test-results-index.test.mjs
node scripts/check-test-results-index.mjs
node scripts/check-doc-image-links.mjs
git diff --check
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend
npm audit --prefix packages/backend --audit-level=high
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

Result at initial local verification:

- Backend build: PASS
- Notification / suppression targeted tests: PASS, 17 tests
- Chat route / ack / mention / read-state / external LLM subset: PASS, 65 tests
- `arch:bounded-context`: PASS, 48 known violations ignored
- `arch:bounded-context:coverage`: PASS
- Backend lint: PASS
- Backend format check: PASS
- `check-test-results-index.test.mjs`: PASS, 2 tests
- `check-test-results-index.mjs`: PASS
- `check-doc-image-links.mjs`: PASS, 115 image links in 308 markdown files
- `git diff --check`: PASS
- Full backend `test:ci`: PASS, 1,136 tests
  - Existing non-fatal `logAudit` P1001 warnings were observed in vendor invoice fallback tests; the suite completed successfully.
- `npm audit --prefix packages/backend --audit-level=high`: PASS, 0 vulnerabilities
- Core E2E: PASS, 105 tests
  - `E2E_PODMAN_HOST_PORT` auto-fell back from 55433 to 55434.

## Notes for PR review

- This slice intentionally does not introduce a generic outbox framework.
- Read-state and external LLM runtime logic are unchanged; existing read-state and external LLM tests are included in the route subset above.
- `ChatNotificationPort` keeps notification creation synchronous relative to the current request path to preserve existing ordering and fail-open behavior.
