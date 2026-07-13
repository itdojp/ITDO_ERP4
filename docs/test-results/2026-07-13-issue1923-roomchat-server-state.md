# Issue #1923 RoomChat server-state boundary verification

## Scope

- Issue: #1923 `refactor(frontend): RoomChatのserver-state hookとmutation境界を抽出する`
- Target component: `packages/frontend/src/sections/RoomChat.tsx`
- New query hooks:
  - `packages/frontend/src/sections/room-chat/useRoomChatRooms.ts`
  - `packages/frontend/src/sections/room-chat/useRoomChatMessages.ts`
  - `packages/frontend/src/sections/room-chat/useRoomChatGlobalSearch.ts`
  - `packages/frontend/src/sections/room-chat/useRoomChatNotificationSetting.ts`
  - `packages/frontend/src/sections/room-chat/useRoomChatCandidates.ts`
- New mutation/command boundary: `packages/frontend/src/sections/room-chat/roomChatApi.ts`

## State classification

| Category | Owner after refactor | Notes |
| --- | --- | --- |
| room list / selected room / project-room resolution | `useRoomChatRooms` | Keeps first-room fallback, GA visibility filtering, and project deep-link lookup. |
| room messages / pagination / unread / read marking | `useRoomChatMessages` | Owns loading/error/hasMore, unread highlight state, refetch, and stale response guard. |
| global message search | `useRoomChatGlobalSearch` | Owns query results, append pagination, loading, and error state. |
| room notification setting | `useRoomChatNotificationSetting` | Owns fetch/save feedback, local datetime conversion, and mute presets. |
| mention / ack candidates | `useRoomChatMentionCandidates` / `useRoomChatAckCandidates` | Owns cancellable candidate loading and debounced ack candidate search. |
| composer body/tags/preview/selection/dialog-like UI state | `RoomChat.tsx` | Remains local UI state and is not treated as server cache. |
| mutation endpoints | `roomChatApi.ts` command functions | Message post, ack request, reaction, ack/revoke/cancel, attachment, room create/invite, notification save, and summaries are centralized. |

## Query / refetch / invalidation behavior

- Room list query: `GET /chat-rooms`; `loadRooms()` invalidates local room list after private group / DM creation.
- Message query: `GET /chat-rooms/:roomId/messages?limit=50[&before][&tag][&q]`; `loadMessages()` is the explicit refetch boundary after post/attachment upload and filter changes.
- Message pagination: append uses the last loaded message `createdAt` as `before`.
- Unread state: message load also reads `GET /chat-rooms/:roomId/unread` and best-effort posts `POST /chat-rooms/:roomId/read`.
- Global search query: `GET /chat-messages/search?q=...&limit=50[&before]`; append uses the last global result `createdAt`.
- Notification setting query/mutation: `GET/PATCH /chat-rooms/:roomId/notification-setting`; save response refreshes the hook state.
- Candidate queries: mention candidates use abort cancellation on room change; ack candidates use a 200ms debounce and abort cancellation.
- Stale response guard: `useRoomChatMessages` tags each load with a request sequence and target room. A slower previous room response cannot overwrite the current room's messages, unread state, or loading state.
- Duplicate submit guard: message post / ack request handler now uses an in-flight ref so rapid repeated submit clicks do not create duplicate POST requests.

## Before / after line count

Measured with `wc -l`:

| File | Before | After |
| --- | ---: | ---: |
| `packages/frontend/src/sections/RoomChat.tsx` | 2238 | 1807 |
| `packages/frontend/src/sections/room-chat/roomChatApi.ts` | 0 | 309 |
| `packages/frontend/src/sections/room-chat/useRoomChatRooms.ts` | 0 | 86 |
| `packages/frontend/src/sections/room-chat/useRoomChatMessages.ts` | 0 | 147 |
| `packages/frontend/src/sections/room-chat/useRoomChatGlobalSearch.ts` | 0 | 64 |
| `packages/frontend/src/sections/room-chat/useRoomChatNotificationSetting.ts` | 0 | 94 |
| `packages/frontend/src/sections/room-chat/useRoomChatCandidates.ts` | 0 | 156 |

`RoomChat.tsx` decreased by 431 lines and is below the current 2500-line gate as well as the planned 2000-line follow-up target.

## Tests added / expanded

- `packages/frontend/src/sections/room-chat/useRoomChatMessages.test.tsx`
  - room list message loading with unread/read side effects
  - short query validation before API call
  - room switch stale response guard
  - load failure error/pagination reset
- `packages/frontend/src/sections/room-chat/useRoomChatGlobalSearch.test.tsx`
  - short global query validation
  - append pagination using the previous last `createdAt`
- `packages/frontend/src/sections/room-chat/roomChatApi.test.ts`
  - message query key construction
  - mutation command endpoint and payload coverage for message, ack, reaction, preview, room create, and notification save
- `packages/frontend/src/sections/RoomChat.test.tsx`
  - duplicate message submit prevention while the first POST is in flight

Existing component tests continue to cover room selection, message filtering, global search/open, notification setting failure behavior, deep room switching, external summary failure, and GA scope filtering.

## Verification commands

Executed locally in `worktrees/roomchat-state-1923-20260713`:

```bash
npm ci --prefix packages/frontend
npm run typecheck --prefix packages/frontend
npm run test --prefix packages/frontend -- src/sections/RoomChat.test.tsx src/sections/room-chat/roomChatModel.test.ts src/sections/room-chat/useRoomChatMessages.test.tsx src/sections/room-chat/useRoomChatGlobalSearch.test.tsx src/sections/room-chat/roomChatApi.test.ts
npm run lint --prefix packages/frontend
npm run format:check --prefix packages/frontend
npm run test --prefix packages/frontend
npm run build --prefix packages/frontend
npm run build:budget --prefix packages/frontend
npm audit --prefix packages/frontend --audit-level=high
node scripts/check-test-results-index.mjs
node scripts/check-doc-image-links.mjs
git diff --check
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

Results so far:

- Frontend dependency install: PASS, 0 vulnerabilities
- Frontend typecheck: PASS
- Targeted RoomChat/server-state tests: PASS, 5 files / 23 tests
- Frontend lint: PASS
- Frontend format check: PASS
- Full frontend test suite: PASS, 81 files / 458 tests
- Frontend build: PASS
- Frontend build budget: PASS
  - Entry JS: 52.2 KiB / gzip 15.9 KiB
  - Initial JS total: 516.7 KiB / gzip 157.8 KiB
  - Largest JS chunk: 289.7 KiB / gzip 87.1 KiB
  - RoomChat chunk: 46.18 kB / gzip 13.19 kB
- Frontend npm audit high: PASS, 0 vulnerabilities
- Test-results index check: PASS
- Markdown image-link check: PASS, 115 image links in 321 markdown files
- `git diff --check
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`: PASS

Core E2E is tracked separately during PR verification because it starts the integrated frontend/backend/DB stack.

## Notes

- No new runtime dependency was added; TanStack Query remains a future optional migration after boundaries are fixed.
- Backend API contracts, UI labels, deep-link event names, attachment download behavior, ack/reaction behavior, notification setting behavior, and existing RoomChat E2E selectors were kept compatible.
