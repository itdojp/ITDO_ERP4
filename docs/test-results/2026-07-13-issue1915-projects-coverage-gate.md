# Issue #1915 Projects coverage gate verification

## 対象

- Issue: #1915 `quality(projects): projects routeを1500行以下へ縮小しcoverage gateを追加する`
- Scope: backend projects route/application/service subset
- 目的: #1912〜#1914で分割した projects 境界を、route-size gate と focused coverage gate で固定する。

## 実装概要

- `coverage:projects` / `coverage:projects:check` を `packages/backend/package.json` に追加した。
- `coverage:projects:check` を既存必須 `CI / backend` job 内へ追加した。branch protection の job 名は増やしていない。
- `packages/backend/coverage-thresholds.json` に `projects` scope を追加した。
- `packages/backend/test/coverageThresholds.test.js` に以下の completeness / regression test を追加した。
  - Org & Project context registry と projects coverage scope の差分検出
  - projects threshold の意図しない低下検出
  - project route/application module の 1500行 gate 維持検出
  - `projects.ts` temporary max-lines allowance 再追加検出
- `packages/backend/test/entityChecks.test.js` を追加し、Org & Project context の small service helper も coverage scope に含めた。

## Route / application line count

| file                                                                     | lines |
| ------------------------------------------------------------------------ | ----: |
| `packages/backend/src/routes/projects.ts`                                |   195 |
| `packages/backend/src/routes/projects/shared.ts`                         |    42 |
| `packages/backend/src/routes/projects/milestones.ts`                     |    88 |
| `packages/backend/src/routes/projects/recurring.ts`                      |    62 |
| `packages/backend/src/routes/projects/tasks.ts`                          |   245 |
| `packages/backend/src/application/projects/useCases.ts`                  |  1139 |
| `packages/backend/src/application/projects/taskUseCases.ts`              |   690 |
| `packages/backend/src/application/projects/milestoneUseCases.ts`         |   343 |
| `packages/backend/src/application/projects/recurringTemplateUseCases.ts` |   282 |

判定: すべて default backend `max-lines` gate（1500行）内。`eslint.config.cjs` に projects temporary allowance は存在しない。

## Coverage scope

`projects.files` は以下を対象とする。

- `bounded-context-registry.cjs` の `org-project` context
  - `src/routes/projects.ts`
  - `src/routes/projects/*.ts`
  - `src/services/entityChecks.ts`
  - `src/services/taskDependencyGraph.ts`
- Projects application orchestration
  - `src/application/projects/*.ts`
- Project recurring due-date helper
  - `src/services/dueDateRule.ts`

## Baseline coverage

Command:

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run coverage:projects:check --prefix packages/backend
```

Result:

| metric     | actual | threshold | result |
| ---------- | -----: | --------: | ------ |
| statements | 66.30% |    66.20% | PASS   |
| lines      | 66.30% |    66.20% | PASS   |
| branches   | 59.67% |    59.50% | PASS   |
| functions  | 77.89% |    77.80% | PASS   |

Test count: 58 tests, all pass.

## Negative / regression coverage

| risk                                               | guard                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Projects対象ファイルをcoverage listから外す        | `projects coverage scope covers current Org & Project modules and shared project helpers` が失敗する                        |
| stale coverage entry                               | 既存 `coverage configured source files exist on disk` と `check-coverage-thresholds.mjs` の file existence check が失敗する |
| coverage低下                                       | `coverage:projects:check` が `projects` threshold 未満で失敗する                                                            |
| `projects.ts` temporary max-lines allowance 再追加 | `projects route uses the default max-lines gate without a temporary allowance` が失敗する                                   |
| 1500行超の project route/application module        | `project route and application modules stay within the default backend line gate` と backend ESLint `max-lines` が失敗する  |

## Local verification

| command                                                                                                | result                                         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `npm ci --prefix packages/backend`                                                                     | PASS（0 vulnerabilities）                      |
| `DATABASE_URL=... npm run build --prefix packages/backend`                                             | PASS                                           |
| `DATABASE_URL=... node scripts/run-tests.js test/coverageThresholds.test.js test/entityChecks.test.js` | PASS（17 tests）                               |
| `DATABASE_URL=... npm run coverage:projects:check --prefix packages/backend`                           | PASS（58 tests; coverage threshold PASS）      |
| max-lines negative smoke（temporary `src/routes/projectsMaxLinesProbe.ts` 1501行）                     | PASS（ESLint `max-lines` が expected failure） |
| `npm run lint --prefix packages/backend`                                                               | PASS                                           |
| `npm run format:check --prefix packages/backend`                                                       | PASS                                           |
| `npm run arch:bounded-context --prefix packages/backend`                                               | PASS（45 known violations ignored）            |
| `npm run arch:bounded-context:coverage --prefix packages/backend`                                      | PASS（unclassified 0 / stale 0）               |
| `DATABASE_URL=... npm run test:ci --prefix packages/backend`                                           | PASS（1166 tests）                             |
| `npm audit --prefix packages/backend --audit-level=high`                                               | PASS（0 vulnerabilities）                      |
| `node scripts/check-test-results-index.mjs`                                                            | PASS                                           |
| `node scripts/check-doc-image-links.mjs`                                                               | PASS（115 image links in 313 markdown files）  |
| `npx --prefix packages/backend prettier --check`（workflow/backend JSON/tests/test-result evidence）   | PASS                                           |
| `git diff --check`                                                                                     | PASS                                           |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                               | PASS（105 tests; port fallback 55433→55437）   |

## Notes / constraints

- #1903 / #1904 は Sakura VPS / HTTPS trial の外部入力が未完了のため、実機 trial smoke はこのPRでは未実行。ローカル/CI coverage gate の成功と実機検証の成功は混同しない。
- 今回は API / project access / hierarchy / task dependency / billing linkage の仕様変更を行っていない。
