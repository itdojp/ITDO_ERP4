# Release Candidate Readiness Evidence Template

## 判定

- Repo-side readiness: `PASS` / `FAIL` / `BLOCKED`
- Overall Go/No-Go: `GO` / `NO-GO` / `BLOCKED`
- E2E scope: `core` / `full`

> release Go の正式 repo-side 証跡は、対象コミットの clean checkout で `RELEASE_E2E_SCOPE=full make release-readiness-record` が生成する `docs/test-results/YYYY-MM-DD-release-readiness-rN.md` を正とする。`make release-readiness` が生成する `tmp/release-readiness/*/summary.md` は限定・調査用証跡であり、正式Go証跡の代替にしない。既定の日付は `RELEASE_TIMEZONE=Asia/Tokyo` のJST基準。対象環境での ActionPolicy 切替、実 S3 restore、外部製品現物CSV確認は別証跡が揃うまで完了扱いにしない。
> #1426 / #544 / #1432 の外部Go依存は `docs/ops/production-readiness-external-evidence.md` に従い、`make production-readiness-external-evidence-check` で `PASS` を確認する。
> `CI job` 欄は GitHub Actions required checks との対応先を示す参照であり、workflow の完全再実行ではない。GitHub Actions / Link Check / CodeQL の結果はPRまたは対象コミットで別途確認する。

## 実行対象

- Commit:
- Branch:
- Dirty:
- Started:
- Ended:
- Duration:

## Tool versions

- node:
- npm:
- git:
- podman:
- uname:

## Check results

| check                   | CI job              | status | exit | duration | command | raw log |
| ----------------------- | ------------------- | ------ | ---: | -------: | ------- | ------- |
| backend-install         | CI / backend        |        |      |          |         |         |
| frontend-install        | CI / frontend       |        |      |          |         |         |
| backend-prisma-generate | CI / backend        |        |      |          |         |         |
| backend-lint            | CI / lint           |        |      |          |         |         |
| backend-format          | CI / lint           |        |      |          |         |         |
| backend-typecheck       | CI / backend        |        |      |          |         |         |
| backend-build           | CI / backend        |        |      |          |         |         |
| backend-test            | CI / backend        |        |      |          |         |         |
| backend-bounded-context | CI / lint           |        |      |          |         |         |
| coverage-auth           | CI / coverage-auth  |        |      |          |         |         |
| coverage-integrations   | CI / backend        |        |      |          |         |         |
| backend-prisma-format   | CI / backend        |        |      |          |         |         |
| backend-prisma-validate | CI / backend        |        |      |          |         |         |
| frontend-lint           | CI / lint           |        |      |          |         |         |
| frontend-format         | CI / lint           |        |      |          |         |         |
| frontend-typecheck      | CI / frontend       |        |      |          |         |         |
| frontend-test           | CI / frontend       |        |      |          |         |         |
| frontend-build          | CI / frontend       |        |      |          |         |         |
| audit-backend           | CI / security-audit |        |      |          |         |         |
| audit-frontend          | CI / security-audit |        |      |          |         |         |
| data-quality-test       | CI / data-quality   |        |      |          |         |         |
| data-quality-blocking   | CI / data-quality   |        |      |          |         |         |
| docs-image-links        | CI / lint           |        |      |          |         |         |
| docs-test-results-index | CI / lint           |        |      |          |         |         |
| ops-docs                | CI / lint           |        |      |          |         |         |
| ops-scripts             | CI / lint           |        |      |          |         |         |
| openapi-snapshot        | CI / api-schema     |        |      |          |         |         |
| secret-scan             | CI / secret-scan    |        |      |          |         |         |
| frontend-e2e            | CI / e2e-frontend   |        |      |          |         |         |

## External Go dependencies

| issue | status   | dependency                                                          |
| ----- | -------- | ------------------------------------------------------------------- |
| #1426 | external | ActionPolicy `phase3_strict` 対象環境 trial / cutover / rollback    |
| #544  | external | S3 バックアップ確定値と実 backup → upload → download → restore 検証 |
| #1432 | external | 給料らくだ・経理上手くんαの現物CSVテンプレート／サンプル回収        |

## Re-run command

```bash
RELEASE_E2E_SCOPE=core make release-readiness
RELEASE_E2E_SCOPE=full make release-readiness
RELEASE_E2E_SCOPE=full make release-readiness-record
make production-readiness-external-evidence-check
```
