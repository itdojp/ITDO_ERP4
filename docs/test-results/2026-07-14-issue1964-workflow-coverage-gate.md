# Issue #1964 Workflow focused coverage gate 検証記録

- 日付: 2026-07-14 JST
- 対象Issue: [#1964](https://github.com/itdojp/ITDO_ERP4/issues/1964)
- 親Issue: [#1900](https://github.com/itdojp/ITDO_ERP4/issues/1900)
- branch: `codex/1964-workflow-coverage-gate-20260714`
- base: `origin/main` `fb3011e45110e0ea88698ae316c94ec9021a45ad`

## 変更概要

Workflow context（ActionPolicy / Approval / Evidence gate / Period lock / Reassignment）に focused coverage gate を追加した。`coverage:workflow:check` は既存必須 job 名を増やさず `CI / backend` に統合し、`packages/backend/coverage-thresholds.json` の `workflow.files` だけを `coverage-summary.json` から再集計する。

production runtime code の API、認可、監査、error code、状態遷移、retry/idempotency、外部副作用順序は変更していない。

## Workflow coverage scope

`coverageThresholds.test.js` が `bounded-context-registry.cjs` の `workflow` context、`src/application/workflow/**`、`src/services/approvalEscalation.ts` から期待scopeを再構成し、設定差分を検出する。

| #   | file                                                | 非空行数 | statements | branches | functions | lines   |
| --- | --------------------------------------------------- | -------- | ---------- | -------- | --------- | ------- |
| 1   | `src/routes/actionPolicies.ts`                      | 231      | 90.24%     | 39.58%   | 100.00%   | 90.24%  |
| 2   | `src/routes/approvalRules.ts`                       | 975      | 31.69%     | 39.50%   | 16.66%    | 31.69%  |
| 3   | `src/routes/periodLocks.ts`                         | 107      | 96.36%     | 88.88%   | 100.00%   | 96.36%  |
| 4   | `src/application/workflow/approvalActionEffects.ts` | 123      | 100.00%    | 63.63%   | 100.00%   | 100.00% |
| 5   | `src/application/workflow/submitApproval.ts`        | 66       | 100.00%    | 50.00%   | 100.00%   | 100.00% |
| 6   | `src/services/actionPolicy.ts`                      | 710      | 84.37%     | 78.64%   | 100.00%   | 84.37%  |
| 7   | `src/services/actionPolicyAudit.ts`                 | 101      | 74.33%     | 100.00%  | 50.00%    | 74.33%  |
| 8   | `src/services/actionPolicyChatAckTargets.ts`        | 8        | 100.00%    | 66.66%   | 100.00%   | 100.00% |
| 9   | `src/services/actionPolicyErrors.ts`                | 18       | 100.00%    | 90.00%   | 100.00%   | 100.00% |
| 10  | `src/services/approval.ts`                          | 993      | 67.51%     | 65.21%   | 88.88%    | 67.51%  |
| 11  | `src/services/approvalDefaultRules.ts`              | 73       | 100.00%    | 100.00%  | 100.00%   | 100.00% |
| 12  | `src/services/approvalEscalation.ts`                | 88       | 100.00%    | 80.00%   | 100.00%   | 100.00% |
| 13  | `src/services/approvalEvidenceGate.ts`              | 99       | 100.00%    | 88.00%   | 100.00%   | 100.00% |
| 14  | `src/services/approvalLogic.ts`                     | 255      | 97.50%     | 85.44%   | 100.00%   | 97.50%  |
| 15  | `src/services/periodLock.ts`                        | 26       | 82.14%     | 66.66%   | 100.00%   | 82.14%  |
| 16  | `src/services/reassignmentLog.ts`                   | 32       | 91.17%     | 20.00%   | 100.00%   | 91.17%  |

### Aggregated baseline / threshold

| metric     | measured           | threshold | result |
| ---------- | ------------------ | --------- | ------ |
| statements | 70.74% (2911/4115) | 70.70%    | PASS   |
| branches   | 70.60% (545/772)   | 70.50%    | PASS   |
| functions  | 84.85% (84/99)     | 84.80%    | PASS   |
| lines      | 70.74% (2911/4115) | 70.70%    | PASS   |

`branches` は実測値が 70.60% と表示されるが内部値は小数第3位以下を含むため、設定閾値は一桁小数の安全側として 70.5% とした。scope file 除外や test skip/only/todo、coverage ignore は使用していない。

## Negative / completeness tests

- Workflow context registry から期待scopeを再構成し、`workflow.files` の対象漏れ・scope shrinkを検出する。
- `coverage configured source files exist on disk` と coverage checker の stale file test により、削除済み/リネーム済み entry を検出する。
- `workflow coverage thresholds stay above the initial focused baseline gate` により閾値の意図しない低下を検出する。
- fake summary を使った `workflow coverage threshold check fails when focused coverage drops below baseline` により、statements / branches / functions / lines の coverage 低下で checker が非0終了することを確認した。

## Local verification

| command                                                                                                                             | result | notes                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `npm ci --prefix packages/backend`                                                                                                  | PASS   | 0 vulnerabilities                                                       |
| `DATABASE_URL=... npm run prisma:generate --prefix packages/backend`                                                                | PASS   | Prisma Client v7.8.0 generated                                          |
| `npm run lint --prefix packages/backend`                                                                                            | PASS   | ESLint                                                                  |
| `npm run format:check --prefix packages/backend`                                                                                    | PASS   | Prettier backend src                                                    |
| `DATABASE_URL=... npm run typecheck --prefix packages/backend`                                                                      | PASS   | after Prisma generate                                                   |
| `DATABASE_URL=... npm run build --prefix packages/backend`                                                                          | PASS   | TypeScript build                                                        |
| `DATABASE_URL=... npm run test --prefix packages/backend -- test/coverageThresholds.test.js test/workflowQualityGateRoutes.test.js` | PASS   | 33 tests                                                                |
| `DATABASE_URL=... npm run test --prefix packages/backend -- test/coverageThresholds.test.js`                                        | PASS   | 22 tests, negative/completeness再確認                                   |
| `DATABASE_URL=... npm run test:ci --prefix packages/backend`                                                                        | PASS   | 1,258 tests, 0 failed                                                   |
| `DATABASE_URL=... npm run coverage:workflow:check --prefix packages/backend`                                                        | PASS   | 126 tests, elapsed 0:31.88                                              |
| `npm run arch:bounded-context --prefix packages/backend`                                                                            | PASS   | 225 modules / 882 dependencies, no violations                           |
| `npm run arch:bounded-context:coverage --prefix packages/backend`                                                                   | PASS   | source files 215, target route/service 204, unclassified 0, duplicate 0 |
| `npm audit --prefix packages/backend --audit-level=high`                                                                            | PASS   | 0 vulnerabilities                                                       |
| `npm ci --prefix packages/frontend`                                                                                                 | PASS   | 0 vulnerabilities                                                       |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                                            | PASS   | 105 tests, Podman port fallback 55433 -> 55434                          |
| `npx --prefix packages/backend prettier --check <changed files>`                                                                    | PASS   | changed files only                                                      |
| `node scripts/check-test-results-index.mjs`                                                                                         | PASS   | docs/test-results index up to date                                      |
| `node scripts/check-doc-image-links.mjs`                                                                                            | PASS   | 115 image links in 329 markdown files                                   |
| `git diff --check`                                                                                                                  | PASS   | whitespace check                                                        |

補足: `npm ci --prefix packages/backend` 後に Prisma Client が再生成されていない状態で `typecheck` を先に実行すると、`@prisma/client` 型未生成に起因する既存の大量エラーで失敗した。Issue本文の検証順に従い `prisma:generate` 後に再実行し PASS を確認した。

## CI integration / execution time

- `.github/workflows/ci.yml` の既存 `CI / backend` job に `npm run coverage:workflow:check` を追加した。
- branch protection 用の job 名は増やしていない。
- local `coverage:workflow:check` final elapsed: `0:31.88`。
- remote `CI / backend` の実測は PR 作成後の GitHub Actions で確認し、PR本文に追記する。

## Compatibility / secrets

- production runtime code は変更していないため、API / RBAC / audit / error code / state transition / retry-idempotency / external side-effect ordering の仕様差分はない。
- synthetic fixtures と stubbed DB route tests のみを追加し、実credential・外部送信・個人情報は使用していない。
- Sakura VPS 実機検証は #1903 lane の外部入力待ちであり、本PRでは実施していない。
