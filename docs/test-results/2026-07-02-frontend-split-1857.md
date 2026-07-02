# Issue #1857 frontend split verification

Date: 2026-07-02 JST
Branch: `codex/frontend-split-1857-20260702`

## Scope

- Split `AdminSettings.tsx` by moving model helpers and policy panel UI into dedicated files.
- Split `RoomChat.tsx` by moving shared model helpers, message list UI, and global search UI into dedicated files.
- Added frontend ESLint `max-lines` gate at 2500 lines.
- Recorded TanStack Query decision in `docs/architecture/frontend-server-state.md`.

## Line count after split

| file                                                                         | lines |
| ---------------------------------------------------------------------------- | ----: |
| `packages/frontend/src/sections/AdminSettings.tsx`                           |  2439 |
| `packages/frontend/src/sections/RoomChat.tsx`                                |  2238 |
| `packages/frontend/src/sections/admin-settings/AdminSettingsPolicyPanel.tsx` |  1008 |
| `packages/frontend/src/sections/admin-settings/adminSettingsModel.ts`        |   492 |
| `packages/frontend/src/sections/room-chat/RoomMessageList.tsx`               |   409 |
| `packages/frontend/src/sections/room-chat/RoomGlobalSearch.tsx`              |   128 |
| `packages/frontend/src/sections/room-chat/roomChatModel.ts`                  |   239 |

## Local verification

- `npm ci --prefix packages/frontend`: PASS, 0 vulnerabilities.
- `npm run typecheck --prefix packages/frontend`: PASS.
- `npm run lint --prefix packages/frontend`: PASS.
- `npm run format:check --prefix packages/frontend`: PASS.
- `npm run test --prefix packages/frontend`: PASS, 78 files / 449 tests.
- Targeted tests:
  - `src/sections/admin-settings/adminSettingsModel.test.ts`: PASS.
  - `src/sections/room-chat/roomChatModel.test.ts`: PASS.
  - `src/sections/AdminSettings.test.tsx`: PASS.
  - `src/sections/RoomChat.test.tsx`: PASS.
- `npm run build --prefix packages/frontend`: PASS.
- `npm audit --prefix packages/frontend --audit-level=high`: PASS, 0 vulnerabilities.
- `node scripts/check-doc-image-links.mjs`: PASS, 115 image links in 296 markdown files.
- `git diff --check`: PASS.

## max-lines gate evidence

Temporary probe file `packages/frontend/src/sections/MaxLinesProbe.tsx` with 2501 nonblank lines caused `npm run lint --prefix packages/frontend` to fail as expected:

```text
File has too many lines (2501). Maximum allowed is 2500  max-lines
```

The probe file was removed and frontend lint passed again.

## E2E

Command:

```bash
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

Result: PASS, 105 tests.

Notes:

- Podman DB port `55433` was unavailable and the script automatically fell back to `55437`.
- `E2E_CAPTURE=0` was used, so no screenshot evidence is expected from this run.
