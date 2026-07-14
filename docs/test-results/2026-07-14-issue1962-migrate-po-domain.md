# Issue #1962 migrate-po domain mapping / validation / report verification

- Date: 2026-07-14 JST
- Issue: [#1962](https://github.com/itdojp/ITDO_ERP4/issues/1962)
- Parent: [#1960](https://github.com/itdojp/ITDO_ERP4/issues/1960)
- Grandparent: [#1900](https://github.com/itdojp/ITDO_ERP4/issues/1900)
- Branch: `codex/1962-migrate-po-domain-20260714`
- Base: `origin/main` `a5acaccc57807f5bdfa1f910d5199ed607a668ca`

## Scope

`#1961` で抽出した `packages/backend/src/migration/poInput.ts` と deterministic ID helper を前提に、`scripts/migrate-po.ts` に残っていた entity mapping、pure validation、planned-id generation、summary/error report formatting を `packages/backend/src/migration/poDomain.ts` へ抽出した。

変更していないもの:

- 現行 CLI option / stdout / stderr prefix / dry-run default / `--apply` confirmation guard
- Prisma apply / transaction / upsert / createMany の順序
- DB query が必要な reference validation と post-apply integrity check
- API、認可、監査、error code、状態遷移、retry/idempotency、外部副作用順序

## Line count and ownership

| File                                              | Before (#1961) | After (#1962) | Notes                                                                                   |
| ------------------------------------------------- | -------------: | ------------: | --------------------------------------------------------------------------------------- |
| `scripts/migrate-po.ts`                           |     2764 lines |    2282 lines | entity mapping / pure validation / report helperを外出し。CLI / DB orchestration は維持 |
| `packages/backend/src/migration/poDomain.ts`      |            n/a |     899 lines | Pure domain module。FS / Prisma / process / console / clock / random sourceなし         |
| `packages/backend/test/migrationPoDomain.test.js` |            n/a |     585 lines | synthetic unit tests + pure dependency guard                                            |
| `packages/backend/src/migration/poInput.ts`       |      190 lines |     190 lines | #1961抽出済み parser / scalar helperを再利用                                            |

## Entity order and dependency rules

`PO_MIGRATION_ENTITY_ORDER` と `buildPoMigrationPlannedIds` により、現行処理順と dry-run/planned reference の範囲を固定した。

| Order | Entity            | Planned ID source                               | Main dependencies kept outside pure module when DB lookup is required                |
| ----: | ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
|     1 | `users`           | `userId`                                        | existing `UserAccount` lookup/update                                                 |
|     2 | `customers`       | `makePoMigrationId('customer', legacyId)`       | existing customer lookup/update                                                      |
|     3 | `vendors`         | `makePoMigrationId('vendor', legacyId)`         | existing vendor lookup/update                                                        |
|     4 | `projects`        | `makePoMigrationId('project', legacyId)`        | customer / parent project reference existence; project chat room upsert              |
|     5 | `tasks`           | `makePoMigrationId('task', legacyId)`           | project reference existence; parent task existence and same-project check            |
|     6 | `milestones`      | `makePoMigrationId('milestone', legacyId)`      | project reference existence                                                          |
|     7 | `estimates`       | `makePoMigrationId('estimate', legacyId)`       | project/task reference existence; document numbering; line writes                    |
|     8 | `invoices`        | `makePoMigrationId('invoice', legacyId)`        | project/estimate/milestone/task reference existence; document numbering; line writes |
|     9 | `purchase_orders` | `makePoMigrationId('purchase_order', legacyId)` | project/vendor/task/expense reference existence; document numbering; line writes     |
|    10 | `vendor_quotes`   | `makePoMigrationId('vendor_quote', legacyId)`   | project/vendor reference existence; document numbering                               |
|    11 | `vendor_invoices` | `makePoMigrationId('vendor_invoice', legacyId)` | project/vendor reference existence; document numbering                               |
|    12 | `time_entries`    | `makePoMigrationId('time_entry', legacyId)`     | project/user/task reference existence                                                |
|    13 | `expenses`        | `makePoMigrationId('expense', legacyId)`        | project/user reference existence                                                     |

DB queryなしで確定できない cross-reference / transaction / integrity rule は `scripts/migrate-po.ts` の orchestration 側に残した。これは #1962 の停止条件に合わせ、DB依存ruleをpure層へ推測で移さないためである。

## Mapping / default / normalization table

| Area              | Extracted domain function(s)                                                                             | Compatibility fixed by tests                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| User              | `mapPoUser`                                                                                              | `userId` / `userName` required error、email array、displayName fallback、`active ?? true`                                        |
| Customer / Vendor | `mapPoCustomer`, `mapPoVendor`                                                                           | deterministic ID、`externalSource='po'`、`externalId`、optional string normalization                                             |
| Project           | `mapPoProject`                                                                                           | status default `active`、customer/parent deterministic IDs、date range blocking error、number fields                             |
| Task              | `normalizePoTaskInputs`, `buildPoTaskProjectMap`, `mapPoTask`                                            | parent key normalization、progress 0..100 + rounding、plan/actual date range blocking errors                                     |
| Milestone         | `mapPoMilestone`                                                                                         | project deterministic ID、`billUpon='acceptance'`、nullable tax rate and invoice template                                        |
| Estimate          | `mapPoEstimateHeader`, `getPoEstimateLines`                                                              | totalAmount >= 0、version min 1、injected numbering fallback date、currency default `JPY`、line fallback `Imported (<legacyId>)` |
| Invoice           | `mapPoInvoiceHeader`, `getPoInvoiceLines`                                                                | totalAmount >= 0、issue/due/fallback numbering date、estimate/milestone IDs、currency default `JPY`                              |
| Purchase order    | `mapPoPurchaseOrderHeader`, `getPoPurchaseOrderLines`                                                    | totalAmount >= 0、project/vendor IDs、issue/due/fallback numbering date、currency default `JPY`                                  |
| Vendor quote      | `mapPoVendorQuoteHeader`                                                                                 | totalAmount >= 0、status default `received`、document URL normalization                                                          |
| Vendor invoice    | `mapPoVendorInvoiceHeader`                                                                               | totalAmount >= 0、status default `received`、received/due/fallback numbering date                                                |
| Time entry        | `mapPoTimeEntry`                                                                                         | invalid workDate blocking error、minutes > 0 + rounding、status default `submitted`                                              |
| Expense           | `mapPoExpense`                                                                                           | invalid incurredOn blocking error、amount >= 0、`isShared === true`、status default `draft`                                      |
| Line validation   | `mapPoLineUnitPrice`                                                                                     | line unitPrice >= 0 blocking error                                                                                               |
| Report            | `withImportTotal`, `formatPoMigrationSummary`, `formatPoMigrationIssues`, `hasPoMigrationBlockingIssues` | JSON pretty-print schema, 50-item default issue cap, exit decision remains “any issue is blocking”                               |

## Validation severity and report schema

Current `migrate-po.ts` has a single `ImportError[]` channel and no separate warning report channel in code, tests, or docs. Therefore #1962 treats the verified current rules as blocking errors and does not introduce a new warning semantic.

| Rule group                                                                                | Severity retained | Where validated                                                    |
| ----------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| CSV required fields / duplicate legacyId / duplicate code                                 | blocking          | `poInput.ts` / existing script calls                               |
| user required `userId` / `userName`                                                       | blocking          | `mapPoUser`                                                        |
| project/task date range, task progress                                                    | blocking          | `mapPoProject`, `mapPoTask`                                        |
| document totalAmount and line unitPrice                                                   | blocking          | document header mappers, `mapPoLineUnitPrice`                      |
| time entry workDate/minutes and expense incurredOn/amount                                 | blocking          | `mapPoTimeEntry`, `mapPoExpense`                                   |
| cross-reference existence / same-project parent-task check / same-project task line check | blocking          | retained in CLI orchestration because DB/planned sets are required |
| apply integrity mismatch / line total mismatch                                            | blocking          | retained in post-apply verify block                                |

Report schema remains the existing JSON array of objects with `scope`, optional `legacyId`, and `message`; `process.exitCode = 1` is set when the issue array is non-empty.

## Synthetic fixture checks

| Fixture                    | Command                                                                                                                                                                                                                                                                          | Expected result                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| header-only `users.csv`    | `TS_NODE_COMPILER_OPTIONS={"types":["node"]} DATABASE_URL=... npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --input-dir=.codex-local/tmp/issue-dispatch-20260714/1962-fixtures/empty-csv --input-format=csv --only=users` | Exit 0, dry-run summary shows `users.total=0`, no DB writes                   |
| invalid project date range | same command with `invalid-project-csv` fixture and `--only=projects`                                                                                                                                                                                                            | Exit 1, error summary includes `startDate must be before or equal to endDate` |

The fixture files were synthetic and kept under `.codex-local/tmp/issue-dispatch-20260714/1962-fixtures/`; no production data, credential, personal data, or customer data was committed.

## Verification

| Command                                                                                                                                                                                                                                    | Result | Notes                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| `npm ci --prefix packages/backend`                                                                                                                                                                                                         | PASS   | backend dependencies installed                                                |
| `DATABASE_URL=... npm run prisma:generate --prefix packages/backend`                                                                                                                                                                       | PASS   | Prisma Client v7.8.0 generated                                                |
| `npm run lint --prefix packages/backend`                                                                                                                                                                                                   | PASS   | backend `src/**/*` ESLint                                                     |
| `npm run format:check --prefix packages/backend`                                                                                                                                                                                           | PASS   | backend `src/**/*` Prettier                                                   |
| `DATABASE_URL=... npm run typecheck --prefix packages/backend`                                                                                                                                                                             | PASS   | TypeScript noEmit                                                             |
| `DATABASE_URL=... npm run build --prefix packages/backend`                                                                                                                                                                                 | PASS   | TypeScript build                                                              |
| `DATABASE_URL=... npm run test --prefix packages/backend -- test/migrationCsv.test.js test/migrationLegacyIds.test.js test/migrationPoInput.test.js test/migrationPoDomain.test.js`                                                        | PASS   | 28 migration tests                                                            |
| `npm run arch:bounded-context --prefix packages/backend`                                                                                                                                                                                   | PASS   | 228 modules / 886 dependencies, no violations                                 |
| `npm run arch:bounded-context:coverage --prefix packages/backend`                                                                                                                                                                          | PASS   | source files 217, target route/service files 204, unclassified 0, duplicate 0 |
| `TS_NODE_COMPILER_OPTIONS={"types":["node"]} DATABASE_URL=... npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --input-dir=.../empty-csv --input-format=csv --only=users`              | PASS   | dry-run exit 0                                                                |
| `TS_NODE_COMPILER_OPTIONS={"types":["node"]} DATABASE_URL=... npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --input-dir=.../invalid-project-csv --input-format=csv --only=projects` | PASS   | exit 1 with expected validation error                                         |
| `DATABASE_URL=... npm run test:ci --prefix packages/backend`                                                                                                                                                                               | PASS   | 1,278 tests; existing non-fatal vendor invoice audit P1001 warnings observed  |
| `npm audit --prefix packages/backend --audit-level=high`                                                                                                                                                                                   | PASS   | 0 vulnerabilities                                                             |
| `npm ci --prefix packages/frontend`                                                                                                                                                                                                        | PASS   | 482 packages audited, 0 vulnerabilities                                       |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                                                                                                                                   | PASS   | 105 tests; Podman port fallback 55433 -> 55434                                |

## Coverage / gate state

- No coverage thresholds were lowered.
- No coverage scope was shrunk.
- No `skip` / `only` / `todo` tests or `coverage ignore` directives were added.
- The pure-module dependency guard fails if `poDomain.ts` introduces FS, Prisma, process, console, real clock, random UUID, or `Math.random` usage.
- Bounded-context coverage remains clean: source files 217, target route/service files 204, invalid/stale/unclassified/duplicate/ambiguous all 0.

## Sakura VPS verification

Not executed for this repository-side issue. #1903 remains independent and was deferred because local SSH config did not expose a safe trial-only alias.

## Residual risks / next step

- `scripts/migrate-po.ts` is reduced but still 2282 lines because CLI option parsing, filesystem I/O, DB apply, transaction, and post-apply integrity remain. #1963 is expected to extract CLI composition / fixture dry-run automation and target the 1200-line principle.
- DB-dependent validation remains in orchestration by design. Moving it into pure code would require a repository/port boundary and should be done in #1963 or a follow-up only if current transaction/failure semantics remain explicit.
- No warning-only migration rule was found in current code/docs/tests; warning semantics were not invented in this PR.
