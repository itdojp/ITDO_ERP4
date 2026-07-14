# Issue #1963 migrate-po CLI orchestration / fixture gate verification

- Date: 2026-07-14
- Issue: #1963
- Parent: #1960
- Grandparent: #1900
- Branch: `codex/1963-migrate-po-cli-fixtures-20260714`
- Base: `origin/main` `a85c0bb88f6bfd2ed6ae633e5ccbf6032ef22de2`

## Scope

`#1961` and `#1962` extracted pure parser / ID / mapping / validation / report helpers. This change makes `scripts/migrate-po.ts` a thin composition root and adds synthetic fixture regression commands for dry-run, blocking failures, deterministic output, apply, rerun/idempotency, and integrity checks.

## Structure and line count

| File                                                     | Lines | Responsibility                                                    |
| -------------------------------------------------------- | ----: | ----------------------------------------------------------------- |
| `scripts/migrate-po.ts` before #1963                     |  2282 | CLI, input I/O, DB apply, integrity orchestration                 |
| `scripts/migrate-po.ts` after #1963                      |    18 | source composition root for manual script execution               |
| `packages/backend/src/migration/poCliEntry.ts`           |    18 | built JS CLI entry for CI fixture execution and Prisma disconnect |
| `packages/backend/src/migration/poCli.ts`                |    97 | CLI help/options/defaults/apply confirmation                      |
| `packages/backend/src/migration/poInputReader.ts`        |   268 | filesystem JSON/CSV input adapter                                 |
| `packages/backend/src/migration/poImporterState.ts`      |    40 | importer state/cache helpers and invocation cache reset           |
| `packages/backend/src/migration/poImportersCore.ts`      |   556 | users/customers/vendors/projects/tasks/milestones importers       |
| `packages/backend/src/migration/poImportersDocuments.ts` |  1188 | estimate/invoice/purchase-order/vendor-doc/time/expense importers |
| `packages/backend/src/migration/poRunner.ts`             |   742 | CLI runner, orchestration, and post-apply integrity checks        |

`packages/backend/test/migrationPoCli.test.js` mechanically verifies that `scripts/migrate-po.ts` and the built CLI entry stay at or below 1200 lines and do not regain parser / mapping / DB entity write responsibilities.

## Synthetic fixtures

All fixtures are under `scripts/fixtures/po-migration/` and use synthetic identifiers, `example.invalid` URLs/emails, and fictitious names/amounts/dates.

| Fixture                | Purpose                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimal-valid-json/`  | all supported entities with references: users, customers, vendors, projects, tasks, milestones, estimates, invoices, purchase orders, vendor quotes, vendor invoices, time entries, expenses |
| `invalid-project-csv/` | blocking validation failure: `startDate` after `endDate`                                                                                                                                     |
| `parse-error-json/`    | malformed JSON parse failure                                                                                                                                                                 |
| `warning-only-json/`   | current compatibility fixture for optional blank-field defaulting. Current CLI has no non-blocking warning channel, so expected behavior is exit 0 and no stderr                             |

`packages/backend/test/migrationPoInputReader.test.js` also scans the committed fixtures for obvious secret-like tokens and non-`example.invalid` email addresses.

## Fixture commands

Standard commands added to `packages/backend/package.json`:

```bash
npm run migration:po:fixture-dry-run --prefix packages/backend
npm run migration:po:fixture-apply --prefix packages/backend
npm run migration:po:fixture-test --prefix packages/backend
```

Safety gates:

- Default fixture DB URL is local-only: `postgresql://user:pass@localhost:5432/po_migration_fixture?schema=public`.
- The runner refuses non-local hosts.
- The runner refuses databases whose name does not start with `po_migration_fixture`, unless `PO_MIGRATION_FIXTURE_ALLOW_SHARED_DATABASE=1` is explicitly set.
- The runner prepares schema with `prisma db push` after the local/dedicated DB preflight.
- The runner invokes the compiled backend CLI entry (`packages/backend/dist/migration/poCliEntry.js`) instead of relying on a TypeScript loader, so CI validates the built artifact under the same Node runtime used by the backend job.
- CI passes `--skip-build` to the fixture command because the backend job has already generated Prisma Client and built the backend before the fixture gates.
- Cleanup deletes only fixture-owned deterministic IDs.

## Local DB integration harness

Local verification used a dedicated rootless Podman PostgreSQL container:

```bash
podman run -d --rm --name erp4-pg-po-fixture-1963 \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=pass \
  -e POSTGRES_DB=po_migration_fixture_local \
  -p 127.0.0.1:55491:5432 \
  docker.io/library/postgres:15@sha256:6ab12ad4395ee49ab49fe19530f7e183c5a9c97fc47cf687b3e281bec5f91ee4

export DATABASE_URL='postgresql://user:pass@localhost:55491/po_migration_fixture_local?schema=public'
```

## Verification summary

| Command                                                                                                                                                                                                                                                | Result | Notes                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL=... npm run prisma:generate --prefix packages/backend`                                                                                                                                                                                   | PASS   | Prisma Client v7.8.0 generated                                                                                                                            |
| `DATABASE_URL=... npm run build --prefix packages/backend`                                                                                                                                                                                             | PASS   | TypeScript compile                                                                                                                                        |
| `DATABASE_URL=... npm run typecheck --prefix packages/backend`                                                                                                                                                                                         | PASS   | TypeScript no-emit check after adding built CLI entry                                                                                                     |
| `DATABASE_URL=... npm run lint --prefix packages/backend`                                                                                                                                                                                              | PASS   | ESLint backend source                                                                                                                                     |
| `DATABASE_URL=... npm run format:check --prefix packages/backend`                                                                                                                                                                                      | PASS   | Prettier backend source                                                                                                                                   |
| `DATABASE_URL=... npm run test:ci --prefix packages/backend -- test/migrationCsv.test.js test/migrationLegacyIds.test.js test/migrationPoInput.test.js test/migrationPoDomain.test.js test/migrationPoCli.test.js test/migrationPoInputReader.test.js` | PASS   | 37 focused migration tests                                                                                                                                |
| `DATABASE_URL=... npm run test:ci --prefix packages/backend -- test/migrationPoCli.test.js test/migrationPoInputReader.test.js`                                                                                                                        | PASS   | 8 focused regression tests after switching the fixture runner to built JS                                                                                 |
| `DATABASE_URL=... npm run migration:po:fixture-dry-run --prefix packages/backend`                                                                                                                                                                      | PASS   | valid dry-run twice, deterministic stdout, dry-run DB non-mutation, invalid CSV exit 1, parse error exit 1, optional defaulting fixture exit 0/no stderr  |
| `DATABASE_URL=... npm run migration:po:fixture-apply --prefix packages/backend`                                                                                                                                                                        | PASS   | valid apply, integrity ok, rerun updates existing deterministic IDs, fixture-owned row counts stable, invalid apply exits 1 without applying fixture rows |
| `DATABASE_URL=... npm run migration:po:fixture-test --prefix packages/backend -- --prepare-db --skip-build`                                                                                                                                            | PASS   | all fixture gates using the compiled backend CLI entry and CI skip-build path                                                                             |

Broader CI-equivalent checks are recorded in the PR body before merge.

## CI integration

The existing required-equivalent `CI / backend` job now starts a local PostgreSQL service and runs:

```bash
npm run migration:po:fixture-dry-run
npm run migration:po:fixture-apply
```

The job name is unchanged; no new branch-protection job is introduced.

## Semantics confirmed / preserved

- CLI help/options/defaults/apply confirmation text are snapshot-tested against the pre-refactor output.
- `--apply` still requires `MIGRATION_CONFIRM=1`.
- Dry-run performs no persistent fixture-owned DB mutations.
- Apply re-run semantics remain deterministic ID upsert/update for the fixture entities.
- Existing per-document transaction blocks for estimate/invoice/purchase-order line replacement remain in the DB orchestration module; no new global transaction semantics were inferred.
- `runPoMigration` clears existence lookup caches at each invocation boundary so stale state is not retained when called multiple times in the same process.
- Current CLI warning behavior is preserved: there is no separate non-blocking warning report channel.

## Residual notes

`poImportersDocuments.ts` is the largest remaining migration module because document write ordering, line replacement transactions, and reference validation are still coupled to the Prisma client and existing migration semantics. This was kept together to avoid changing transaction / failure semantics by inference. The root CLI script is now mechanically guarded against re-growth, and all new migration source files stay below the backend 1500-line gate.
