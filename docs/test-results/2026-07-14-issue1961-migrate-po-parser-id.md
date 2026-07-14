# Issue #1961 migrate-po parser / encoding / ID pure module verification

- Date: 2026-07-14 JST
- Issue: [#1961](https://github.com/itdojp/ITDO_ERP4/issues/1961)
- Parent: [#1960](https://github.com/itdojp/ITDO_ERP4/issues/1960)
- Grandparent: [#1900](https://github.com/itdojp/ITDO_ERP4/issues/1900)
- Branch: `codex/1961-migrate-po-parser-id-20260714`
- Base: `origin/main` `6a9ef0b6e7b32ef41e09f5cfac4605f0cadb7a9c`

## Scope

`scripts/migrate-po.ts` の CSV/JSON input parsing、UTF-8 byte decode boundary、scalar normalization、CSV required-field handling、duplicate detectionを `packages/backend/src/migration/poInput.ts` へ抽出した。既存の deterministic ID generation は `packages/backend/src/migration/legacyIds.ts` を継続利用し、今回の tests で固定値と pure-module 依存制約を追加検証した。

API、認可、監査、error code、状態遷移、retry/idempotency、外部副作用順序は変更していない。migration script の DB orchestration / Prisma write path / `--apply` guard は変更していない。

## Line count and ownership

| File                                             |     Before |      After | Notes                                                                                                   |
| ------------------------------------------------ | ---------: | ---------: | ------------------------------------------------------------------------------------------------------- |
| `scripts/migrate-po.ts`                          | 2893 lines | 2764 lines | parser / encoding / scalar / duplicate helpersを外出し。CLI option / output / summary / exit pathは維持 |
| `packages/backend/src/migration/poInput.ts`      |        n/a |  190 lines | Pure input module。FS / Prisma / process / console / clock / random sourceなし                          |
| `packages/backend/src/migration/legacyIds.ts`    |   37 lines |   37 lines | deterministic UUIDv5 ID generationを継続。固定出力testを追加                                            |
| `packages/backend/test/migrationPoInput.test.js` |        n/a |  248 lines | synthetic fixture unit tests + pure dependency guard                                                    |

## Extracted responsibilities

| Area                 | New boundary                                                                      | Compatibility note                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| byte decode          | `decodePoMigrationBytes`                                                          | Existing CLI input is UTF-8. BOM is preserved at decode stage and stripped by existing CSV parser where applicable. Unsupported encodings fail explicitly instead of guessing CP932 behavior. |
| JSON input           | `parsePoJson`                                                                     | Strict `JSON.parse` semantics are preserved.                                                                                                                                                  |
| CSV records          | `parsePoCsvRecords`                                                               | Existing `parseCsvRaw` behavior is preserved: UTF-8 BOM handling, CRLF/LF, quoted cells, escaped quotes, multiline cells, blank-row skipping, header-only empty result.                       |
| CSV typed items      | `parseCsvItems`                                                                   | Required-field error shape (`scope`, `legacyId`, `message`) and post-processing hook are preserved.                                                                                           |
| CSV JSON field       | `parseCsvJsonArray`                                                               | Non-array and malformed JSON field errors keep existing messages.                                                                                                                             |
| scalar normalization | `parseDate`, `parseNumber`, `parseEnumValue`, `normalizeString`, `normalizeLines` | Existing normalization semantics are preserved, including current `parseNumber('') === 0` behavior.                                                                                           |
| duplicate guard      | `ensureNoDuplicates`                                                              | Existing `duplicate legacyId` / `duplicate code: ...` error messages are preserved.                                                                                                           |
| deterministic ID     | `makePoMigrationId`                                                               | Existing UUIDv5 implementation is verified with fixed expected IDs; no random UUID source is used.                                                                                            |

## Synthetic fixture checks

| Fixture                     | Command                                                                                                                                                                                                                                                                          | Expected result                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| header-only `users.csv`     | `TS_NODE_COMPILER_OPTIONS={"types":["node"]} DATABASE_URL=... npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --input-dir=.codex-local/tmp/issue-dispatch-20260714/1961-fixtures/empty-csv --input-format=csv --only=users` | Exit 0, dry-run summary shows `users.total=0`, no DB writes       |
| missing required `userName` | same command with `invalid-csv` fixture                                                                                                                                                                                                                                          | Exit 1, error summary includes `missing required field: userName` |

`TS_NODE_COMPILER_OPTIONS={"types":["node"]}` は existing `packages/backend/tsconfig.json` が `include: ["src/**/*"]` で script 実行用ではないため、ローカル検証時に Node globals を明示するために使用した。script itself の CLI option / output / exit behaviorは変更していない。

## Verification

| Command                                                                                                                                                                                                                         | Result | Notes                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `npm ci --prefix packages/backend`                                                                                                                                                                                              | PASS   | 568 packages audited, 0 vulnerabilities                                                            |
| `DATABASE_URL=... npm run prisma:generate --prefix packages/backend`                                                                                                                                                            | PASS   | Prisma Client v7.8.0 generated                                                                     |
| `npm run lint --prefix packages/backend`                                                                                                                                                                                        | PASS   | backend `src/**/*` ESLint                                                                          |
| `npm run format:check --prefix packages/backend`                                                                                                                                                                                | PASS   | backend `src/**/*` Prettier                                                                        |
| `DATABASE_URL=... npm run typecheck --prefix packages/backend`                                                                                                                                                                  | PASS   | TypeScript noEmit                                                                                  |
| `DATABASE_URL=... npm run build --prefix packages/backend`                                                                                                                                                                      | PASS   | TypeScript build                                                                                   |
| `DATABASE_URL=... npm run test --prefix packages/backend -- test/migrationCsv.test.js test/migrationLegacyIds.test.js test/migrationPoInput.test.js`                                                                            | PASS   | 19 tests                                                                                           |
| `npm run arch:bounded-context:coverage --prefix packages/backend`                                                                                                                                                               | PASS   | source files 216, unclassified 0, duplicate 0                                                      |
| `npx --prefix packages/backend prettier --check packages/backend/src/migration/poInput.ts packages/backend/test/migrationPoInput.test.js`                                                                                       | PASS   | changed formatted files only; existing `scripts/migrate-po.ts` formatting baseline is not expanded |
| `TS_NODE_COMPILER_OPTIONS={"types":["node"]} DATABASE_URL=... npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --input-dir=.../empty-csv --input-format=csv --only=users`   | PASS   | dry-run exit 0                                                                                     |
| `TS_NODE_COMPILER_OPTIONS={"types":["node"]} DATABASE_URL=... npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --input-dir=.../invalid-csv --input-format=csv --only=users` | PASS   | exit 1 with expected validation error                                                              |
| `DATABASE_URL=... npm run test:ci --prefix packages/backend`                                                                                                                                                                    | PASS   | 1,269 tests                                                                                        |
| `npm run arch:bounded-context --prefix packages/backend`                                                                                                                                                                        | PASS   | 227 modules / 884 dependencies, no violations                                                      |
| `npm audit --prefix packages/backend --audit-level=high`                                                                                                                                                                        | PASS   | 0 vulnerabilities                                                                                  |
| `npm ci --prefix packages/frontend`                                                                                                                                                                                             | PASS   | 482 packages audited, 0 vulnerabilities                                                            |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                                                                                                                        | PASS   | 105 tests; Podman port fallback 55433 -> 55437                                                     |
| `node scripts/check-test-results-index.mjs`                                                                                                                                                                                     | PASS   | docs/test-results index up to date                                                                 |
| `node scripts/check-doc-image-links.mjs`                                                                                                                                                                                        | PASS   | 115 image links in 330 markdown files                                                              |
| `git diff --check`                                                                                                                                                                                                              | PASS   | whitespace check                                                                                   |

## Coverage / gate state

- No coverage thresholds were lowered.
- No coverage scope was shrunk.
- No `skip` / `only` / `todo` tests or `coverage ignore` directives were added.
- The pure-module dependency guard fails if `poInput.ts` or `legacyIds.ts` introduces FS, Prisma, process, console, clock, or random UUID/random sources.

## Sakura VPS verification

Not executed for this repository-side issue. #1903 remains independent and was deferred because local SSH config did not expose a safe trial-only alias.

## Residual risks

- CP932 / Shift_JIS behavior is not introduced because no current CLI option, docs, or tests define non-UTF-8 PO import semantics. Adding such support should be a separate issue with explicit encoding and fixture requirements.
- The local `ts-node --project packages/backend/tsconfig.json` invocation needs Node type injection because the backend tsconfig is scoped to `src/**/*`; this is an existing script-execution ergonomics issue and is not changed in #1961.
