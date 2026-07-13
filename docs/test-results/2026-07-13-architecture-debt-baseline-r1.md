# Architecture debt baseline r1 (Issue #1928 repo-side)

## 対象

- Issue: #1928 `arch: bounded-context既知違反baselineをゼロ化し負債削減証跡を作る`
- Parent: #1900
- 実施日: 2026-07-13 JST
- 対象commit: 本証跡を含むPR head commit

## 位置づけ

この証跡は #1928 の repo-side baseline zero 化を記録する。#1903 / #1904 の実Sakura VPS証跡は未完了であり、#1928 issue本文の停止条件に従い、このPRでは `Closes #1928` を使用しない。

## 子Issue状態

|        Issue | 状態   | 備考                                                                    |
| -----------: | ------ | ----------------------------------------------------------------------- |
|        #1901 | closed | bounded-context classification coverage gate                            |
|        #1902 | closed | Sakura VPS profile definition                                           |
|        #1903 | open   | 実VPS接続情報・trial env・実行承認待ち。成功証跡は未作成。              |
|        #1904 | open   | #1903完了、trial FQDN、Google OAuth client、接続元制限方針待ち。        |
| #1905〜#1927 | closed | architecture / frontend quality child issues completed through #1927    |
|        #1928 | open   | repo-side baseline zeroは本PRで対応。VPS証跡待ちのためIssueはopen維持。 |

## Bounded-context known violations

### 初期値と現在値

| 時点                | total | Identity & Access | Org & Project | Documents | Workflow | Chat | 備考                                                                    |
| ------------------- | ----: | ----------------: | ------------: | --------: | -------: | ---: | ----------------------------------------------------------------------- |
| 2026-07-02 baseline |    60 |                 2 |             3 |        46 |        4 |    5 | #1928本文に記録された初期値                                             |
| #1927 merge後       |     2 |                 0 |             0 |         2 |        0 |    0 | `dailyReports` / `leaveUpcomingNotifications` のNotifications依存が残存 |
| 本PR                |     0 |                 0 |             0 |         0 |        0 |    0 | `dependency-cruiser-known-violations.json` は空配列 `[]`                |

### 今回削除した最後の2件

Before:

```text
src/routes/dailyReports.ts
  -> src/services/appNotifications.ts

src/services/leaveUpcomingNotifications.ts
  -> src/services/appNotifications.ts
```

After:

```text
src/routes/dailyReports.ts
  -> src/application/dailyReports/sideEffects.ts
       -> src/services/appNotifications.ts

src/routes/notificationJobs.ts
  -> src/application/leave/upcomingNotifications.ts
       -> src/services/appNotifications.ts
```

`src/application/**` は application-orchestration layerとして分類し、Documents core route/serviceからNotifications contextへの直接importは0件になった。

## Negative tests

`packages/backend/test/boundedContextCoverage.test.js` に以下を追加した。

| test                                                                                                  | 目的                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `bounded-context direction gate: known violations baseline is zero`                                   | baseline fileが空配列 `[]` であることを固定する                                                                 |
| `bounded-context direction gate: zero baseline still rejects a new Documents to Notifications import` | 空baselineでも新規 `Documents -> Notifications` 直接importがdependency-cruiserでfailすることをfixtureで検証する |

既存coverage gate testsにより以下も継続検証される。

- 未分類route/service/application fileでfail
- 重複bounded-context分類でfail
- stale patternでfail
- explicit generated/excluded entryの理由漏れでfail

## Route max-lines temporary allowances

backend ESLint `max-lines` defaultは1500行（blank行除外）。一時allowanceは以下の2件。

| file                                |  cap | physical lines observed | 削減条件                                            |
| ----------------------------------- | ---: | ----------------------: | --------------------------------------------------- |
| `src/routes/chat.ts`                | 1650 |                    1592 | ack / attachment / route module をさらに service 化 |
| `src/routes/reportSubscriptions.ts` | 1600 |                    1533 | schedule/run/history 処理を service 化              |

#1908 / #1911 / #1915 / #1920 により、`auth.ts`、`chatRooms.ts`、`projects.ts`、`vendorDocs.ts` はdefault 1500行gate内に戻っている。

## Focused coverage scopes

| scope        | files | statements | branches | functions | lines |
| ------------ | ----: | ---------: | -------: | --------: | ----: |
| auth         |    16 |       89.7 |     70.5 |      97.9 |  89.7 |
| integrations |    10 |       91.1 |     72.7 |      97.0 |  91.1 |
| chat         |    38 |       53.4 |     59.4 |      70.1 |  53.4 |
| projects     |    12 |       66.2 |     59.5 |      77.8 |  66.2 |

`packages/backend/test/coverageThresholds.test.js` がscope fileの存在、stale entry、主要scope completeness、閾値低下を検出する。

## ローカル検証

実行済み:

- `npm ci --prefix packages/backend`
  - 結果: PASS（0 vulnerabilities）
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run prisma:generate --prefix packages/backend`
  - 結果: PASS
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run build --prefix packages/backend`
  - 結果: PASS
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend -- test/dailyReportSideEffects.test.js test/leaveUpcomingNotifications.test.js test/boundedContextCoverage.test.js test/coverageThresholds.test.js`
  - 結果: PASS（33 tests）
- `DATABASE_URL=postgresql://user:pass@localhost:5432/postgres?schema=public npm run test:ci --prefix packages/backend`
  - 結果: PASS（1,239 tests）
  - 補足: 既存のvendor invoice fallback audit系で、監査ログのfail-open経路を通る非致命のPrisma P1001 warningが出力される。
- `npm run lint --prefix packages/backend`
  - 結果: PASS
- `npm run format:check --prefix packages/backend`
  - 結果: PASS
- `npm run arch:bounded-context --prefix packages/backend`
  - 結果: PASS（221 modules / 859 dependencies、known violations 0）
- `npm run arch:bounded-context:coverage --prefix packages/backend`
  - 結果: PASS（211 source files / 200 target route/service/application files、unclassified 0、stale 0）
- `npm audit --prefix packages/backend --audit-level=high`
  - 結果: PASS（0 vulnerabilities）
- `node scripts/check-test-results-index.mjs`
  - 結果: PASS
- `node scripts/check-doc-image-links.mjs`
  - 結果: PASS（115 image links in 326 markdown files）
- `npm ci --prefix packages/frontend`
  - 結果: PASS（0 vulnerabilities）
- `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`
  - 結果: PASS（105 tests）
  - 補足: Podman DB host portは `55433` が使用中だったため `55437` へ自動フォールバック。
- `git diff --check`
  - 結果: PASS

## 残ブロッカー

#1903 / #1904 は実VPS、DNS、trial OAuth等の外部入力が必要であり、このCodex環境だけでは成功証跡を作れない。#1928 / #1900 の完了判定では、repo-side baseline zeroとVPS実機証跡を分けて判断する。
