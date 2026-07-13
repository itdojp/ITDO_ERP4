# Issue #1924 AdminSettings resource hook / form-state boundary verification

- Date: 2026-07-13 JST
- Issue: #1924 `refactor(frontend): AdminSettingsのresource hookとform state境界を抽出する`
- Branch: `codex/adminsettings-state-1924-20260713`
- Base: `origin/main` at `20b38484e1c90a1e2985d27ed0f5ba153de65846`

## Scope

`AdminSettings.tsx` に残っていた resource query / mutation / form-state orchestration を、resource単位の個別hookへ分離した。React Query は追加していない。

| Boundary                   | File                                                                          | Responsibility                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Common helpers             | `packages/frontend/src/sections/admin-settings/adminSettingsResourceUtils.ts` | JSON parse error feedback、nullable text normalization、message/error sink型                                   |
| Policy resources           | `useAdminSettingsPolicyResources.ts`                                          | approval rules、ActionPolicy、chat ack templates、audit history state、form parse/serialize、save/reset/toggle |
| Template resources         | `useAdminSettingsTemplates.ts`                                                | template settings、PDF template query、kind別auto-select、save/default/reset                                   |
| Report resources           | `useAdminSettingsReports.ts`                                                  | report subscriptions、deliveries、dry-run、run-all、form parse/serialize                                       |
| Integration resources      | `useAdminSettingsIntegrations.ts`                                             | integration settings、run history、metrics、run trigger、form parse/serialize                                  |
| Integration export jobs    | `useAdminSettingsIntegrationExportJobs.ts`                                    | export job filters、load、redispatch idempotency                                                               |
| Integration reconciliation | `useAdminSettingsReconciliation.ts`                                           | period key、summary/details query、stale response guard                                                        |
| Accounting mapping rules   | `useAdminSettingsAccountingMappingRules.ts`                                   | rule filters、form validation/save/reset、reapply、duplicate-submit guard                                      |

## Before / after line count

| File                                        | Before | After | Notes                                                                                                          |
| ------------------------------------------- | -----: | ----: | -------------------------------------------------------------------------------------------------------------- |
| `AdminSettings.tsx`                         |   2439 |   929 | top-level orchestration now focuses on layout, alert wizard, and hook wiring                                   |
| `useAdminSettingsPolicyResources.ts`        |      0 |   813 | largest extracted hook because approval/audit/actionPolicy/ack template remain tightly coupled in policy panel |
| `useAdminSettingsAccountingMappingRules.ts` |      0 |   266 | accounting form/query/reapply boundary                                                                         |
| `useAdminSettingsReports.ts`                |      0 |   232 | report subscription/delivery boundary                                                                          |
| `useAdminSettingsTemplates.ts`              |      0 |   210 | template resource boundary                                                                                     |
| `useAdminSettingsIntegrations.ts`           |      0 |   176 | integration settings/run/metrics boundary                                                                      |
| `useAdminSettingsReconciliation.ts`         |      0 |   128 | reconciliation stale guard boundary                                                                            |
| `useAdminSettingsIntegrationExportJobs.ts`  |      0 |    99 | export job query/redispatch boundary                                                                           |
| `adminSettingsResourceUtils.ts`             |      0 |    24 | common parse/normalization helpers                                                                             |

## Regression and gap coverage

Added `packages/frontend/src/sections/admin-settings/adminSettingsHooks.test.tsx` to cover:

- duplicate integration setting submit while save is in-flight;
- template kind change auto-selecting the first matching PDF template;
- template save retry after successful and failed submissions to prove the in-flight guard is released;
- approval rule audit history lookup keyed by series and merged across rule versions;
- stale reconciliation details ignored after period key changes;
- accounting mapping dependent required-field validation before API calls;
- ActionPolicy JSON validation before mutation requests.

Stabilized existing unrelated frontend tests exposed by full suite execution:

- `GroupManagementCard.test.tsx`: wait for selected group members before validating create form interactions.
- `RoomChat.test.tsx`: wait for first-page global search completion and enabled pagination before clicking `さらに読み込む`.

## Verification

| Command                                                                                                                                                                            | Result | Notes                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------- |
| `npm ci --prefix packages/frontend`                                                                                                                                                | PASS   | 0 vulnerabilities                                   |
| `npm run typecheck --prefix packages/frontend`                                                                                                                                     | PASS   | TypeScript no-emit                                  |
| `npm run test --prefix packages/frontend -- src/sections/admin-settings/adminSettingsHooks.test.tsx src/sections/AdminSettings.test.tsx`                                           | PASS   | 2 files / 25 tests                                  |
| `npm run test --prefix packages/frontend -- src/sections/GroupManagementCard.test.tsx src/sections/admin-settings/adminSettingsHooks.test.tsx src/sections/AdminSettings.test.tsx src/sections/RoomChat.test.tsx` | PASS   | 4 files / 42 tests                                  |
| `npm run test --prefix packages/frontend`                                                                                                                                          | PASS   | 82 files / 468 tests                                |
| `npm run lint --prefix packages/frontend`                                                                                                                                          | PASS   | ESLint including max-lines gate                     |
| `npm run format:check --prefix packages/frontend`                                                                                                                                  | PASS   | Prettier check                                      |
| `npm run build --prefix packages/frontend`                                                                                                                                         | PASS   | `AdminSettings` chunk `145.14 kB` / gzip `30.93 kB` |
| `npm run build:budget --prefix packages/frontend`                                                                                                                                  | PASS   | initial JS `516.7 KiB` / gzip `157.7 KiB`           |
| `npm audit --prefix packages/frontend --audit-level=high`                                                                                                                          | PASS   | 0 vulnerabilities                                   |
| `node scripts/check-test-results-index.mjs`                                                                                                                                        | PASS   | index up to date                                    |
| `node scripts/check-doc-image-links.mjs`                                                                                                                                           | PASS   | 115 image links in 322 markdown files               |
| `git diff --check`                                                                                                                                                                 | PASS   | whitespace check                                    |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                                                                           | PASS   | 105 tests; Podman DB port fallback 55433 -> 55434   |

## Compatibility notes

- No new dependency was added.
- Setting API paths, payload fields, labels, permission gate for `system_admin`, deep-link/audit data retrieval semantics, and existing card props were preserved.
- Existing child cards (`ChatSettingsCard`, `ChatRoomSettingsCard`, `GroupManagementCard`, `ScimSettingsCard`, `RateCardSettingsCard`, `WorklogSettingsCard`, `AuthIdentityMigrationCard`) already own their resource state and were not converted to a generic hook.
- The implementation intentionally avoids a single giant `useAdminSettingsResource(resource)` hook; each resource boundary has explicit types and validation rules.
