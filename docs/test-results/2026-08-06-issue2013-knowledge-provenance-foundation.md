# Issue #2013 Knowledge provenance foundation verification（PR A）

## Scope

- Baseline: `40eb3985acbdfa290909ebe7e198a74ca171e953`
- Branch: `feat/2013-knowledge-provenance-foundation`
- Issue: `#2013`（PR Aは`Refs #2013`。import/UI未完了のためIssueをcloseしない）
- Environment: local repository tests and ephemeral PostgreSQL 15
- Fixtures: synthetic actor/item/annotation/conversation/synthesis data only

本記録はbackend provenance foundationのrepository-side証跡である。production migration、
Sakura VPS、Google Drive、Sakura Object Storage、external LLM、実credentialの検証結果では
ない。

## Implemented contract

- annotation、immutable revision、conversation、item relation、append-only turn、
  synthesis、immutable version、typed sourceを別entityとして追加した。
- annotation kind/origin、turn role、item/source relation typeを明示enumで固定した。
- conversation readは全linked itemのcurrent ACL共通部分を必要とし、cross-owner relationを
  sanitized not-foundとして拒否する。
- synthesis sourceは明示FKとexactly-one CHECKで一件を参照する。read時もsource accessを
  再検査し、失効したsource identity/bodyを返さない。同一synthesisの過去version参照も
  application検査とDB constraint triggerの両方で拒否する。
- recursive provenanceはrequest-scoped memoization、16段、version node 128、source edge
  512、DB query 512でboundedにし、cycle/budget/source-less organization accessをfail
  closedにする。memo keyへ到達depthを含め、source順序によるdepth上限迂回を防ぐ。mutation内
  でも一つのcontextを共有する。synthesis listのhidden candidate scanは200件で停止し、上限の
  200件目がvisible lookaheadでもnext cursorを返さない。
- manual APIは自由文字列のprovider/model/tool nameを受け付けず、responseも`null`へ固定する。
- annotation owner操作はparent itemが非削除であること、version historyはlookahead source
  ACLを再検査する。AuditLog DB CHECKはaction groupと非NULL target table/IDを厳密に対応
  付ける。
- annotation本文query自体にparent item ACL predicateを含める。各ACL付きrepository queryを
  point-in-timeの認可線形化点とし、それ以前にcommitした失効はfail closed、それ以後の失効は
  後続requestから反映する。進行中transactionの遡及取消しやgrant rowの長時間lockは行わない。
- annotation historyとconversation turn listは、parent visibilityの事前確認後も子tableの
  本文query自体でcurrent parent ACLを再検査する。事前確認と本文queryの間にgrant revokeと
  ownerによる履歴追加を挟むPostgreSQL 15実統合試験で、新規本文を返さないことを確認した。
- conversation-itemの同一owner制約をapplication検査とdeferrable DB constraint triggerの
  二層で保証し、Prisma直接insertによるcross-owner relationもSQLSTATE 23514で拒否する。
- mutation、version/idempotency確定、mandatory Knowledge auditを同一transactionで処理し、
  audit metadataへ本文、prompt、URL、provider/request key、raw errorを入れない。複数source
  ACLはread/mutationとも一つのRepeatable Read snapshotで評価し、grant swapによる時点混在を
  防ぐ。
- annotation revision、conversation turn、synthesis version/sourceは新規table専用triggerで
  update/deleteを拒否し、API経路外でもimmutable historyを保つ。
- listはstable sort、bounded limit、actor/resource/parentへ束縛したHMAC署名付きopaque
  cursorを使用する。
- migrationはexpand-onlyで、既存table/column/dataをdrop、rename、更新しない。

## Focused tests

| Verification                                        | Result | Evidence                                                                                                                        |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| provenance schema / constraint / migration contract | PASS   | explicit enum、content/version/hash/scope bounds、exactly-one FK、single primary、expand-only、OpenAPI assertions               |
| signed cursor                                       | PASS   | actor/resource/parent/sort binding、tamper rejection、production secret requirement                                             |
| application use cases                               | PASS   | annotation history/delete/audit rollback、cross-owner relation、role-origin、turn/version conflict、manual provenance label拒否 |
| Prisma adapter                                      | PASS   | Repeatable Read、ACL intersection、depth-aware memo/cycle/budget、200件境界、same-aggregate拒否、source-less fail-close         |
| route contract                                      | PASS   | canonical actor、signed cursor、null-only label schema、unknown-field rejection、budget時のnon-disclosing empty/404             |

Result: **54/54 PASS**（fail/skip/todo 0）

Focused command:

```bash
cd packages/backend
node scripts/run-tests.js \
  test/knowledgeProvenanceSchema.test.js \
  test/knowledgeProvenanceCursor.test.js \
  test/knowledgeProvenanceUseCases.test.js \
  test/knowledgeProvenancePrismaAdapter.test.js \
  test/knowledgeProvenanceRoutes.test.js
```

## PostgreSQL 15 migration/integration

Command:

```bash
make knowledge-provenance-postgres
```

Pinned image:

```text
postgres:15@sha256:6ab12ad4395ee49ab49fe19530f7e183c5a9c97fc47cf687b3e281bec5f91ee4
```

Result: **PASS**

- personal owner success / outsider 404
- organization valid group success / invalid group 404
- multi-item conversation ACL intersection
- cross-owner relation existence non-disclosure
- direct DB cross-owner relation rejection
- annotation historyの事前ACL確認後にgrant revokeとrevision追加を挟んでも本文非返却
- conversation turnの事前ACL確認後にgrant revokeとturn追加を挟んでも本文非返却
- concurrent turn append: one success / one conflict
- concurrent synthesis version: one success / one conflict
- synthesis source exactly-one CHECK rejects zero/two references
- same-synthesis historical source is rejected by application and DB trigger
- concurrent grant swapでも複数source ACLを一つのRepeatable Read snapshotとして評価
- annotation revision、conversation turn、synthesis version/sourceのupdate/deleteを
  immutable history triggerが拒否
- source-less organization synthesis is owner-readable but non-owner fail-closed
- deleted parent item blocks annotation history/revision
- audit action/target mismatches are rejected by the database CHECK
- audit target table/IDのNULLもdatabase CHECKで拒否
- annotation revision、conversation turn、synthesis versionの実repository複数page取得で
  重複・欠落なし
- organization synthesis historyのlookaheadを実DBで評価し、返却済みpage boundaryの次回利用前に
  source ACLが失効した場合はnot-foundへfail closed
- source logical deletion causes provenance redaction
- mandatory audit failure rolls back the business mutation
- audit rows contain no annotation/turn/synthesis bodies
- Prisma schemaとmigrationのKnowledge provenance table/indexに新規driftなし
- migration deploy/status succeeded

visible-hidden-visible synthesis list、hidden rowをcursorにしないこと、署名cursorのroute往復は
focused adapter/route testで検証した。PostgreSQL integrationはservice/repositoryのpage boundaryを
検証しており、実DBとHTTP routeを同時に通す署名cursor結合試験ではない。

## Old-application compatibility

Command:

```bash
make knowledge-provenance-old-app
```

Result: **PASS**

- exact baseline `40eb3985acbdfa290909ebe7e198a74ca171e953` application was built against
  the post-migration database.
- existing Knowledge data remained present.
- old application Knowledge CRUD and optimistic version progression succeeded.
- `/healthz` and `/readyz` returned 200.
- migration count advanced from 97 to 98 without changing existing rows.

## Repository quality gates

| Gate                                      | Result  | Notes                                                                                                                            |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Prisma format/generate                    | PASS    | Prisma 7.9.1                                                                                                                     |
| root lint / format / typecheck / build    | PASS    | backend/frontend。frontend dev dependenciesはlockfile準拠の`npm ci`後に実行                                                      |
| `make test`                               | PASS    | backend 1,869/1,869、frontend 85 files / 495 tests。fail/skip/todo 0                                                             |
| focused coverage                          | PASS    | selected files aggregate: statements/lines 80.79%、branches 68.42%、functions 83.44%。threshold/scope変更なし                    |
| bounded-context dependency/coverage       | PASS    | 308 modules / 1,210 dependencies、293 source files / 244 targets、unclassified/duplicate/ambiguous 0                             |
| OpenAPI export / breaking diff            | PASS    | generated snapshotとtracked fileはbyte-identical。baselineからbreaking 0、18 operation追加のみ                                   |
| `make ops-quality`                        | PASS    | live systemd/provider操作なし。S3 profile 22/22、storage readiness 2/2を含む                                                     |
| backend/frontend security audit           | PASS    | `npm audit --audit-level=high`: 0 vulnerabilities / 0 vulnerabilities                                                            |
| docs index / image links                  | PASS    | index current、118 image links / 351 Markdown files                                                                              |
| secret scan / `git diff --check`          | PASS    | candidate filesを含むtracked scan 0 match、whitespace error 0                                                                    |
| independent/Copilot review / CI / cooling | PENDING | Repeatable Read、depth memo、200件境界、same-aggregate/immutable DB保証を追加修正済み。final exact headで再review/CI/coolingする |

Focused coverageのうち、main infrastructure adapterはc8計測でstatements/lines 67.38%、
branches 67.22%、functions 77.77%、audit adapterはstatements/lines 88.59%、branches
73.91%、functions 100%、request access contextは全指標100%だった。実DB経路は
上記のPostgreSQL 15 integrationで追加検証している。coverage threshold、対象scope、
ignore、skipは変更していない。

## Audit events

- `knowledge_annotation_created`
- `knowledge_annotation_revised`
- `knowledge_annotation_deleted`
- `knowledge_conversation_created`
- `knowledge_conversation_item_linked`
- `knowledge_conversation_item_unlinked`
- `knowledge_conversation_turn_appended`
- `knowledge_synthesis_created`
- `knowledge_synthesis_version_appended`
- `knowledge_synthesis_source_linked`

Import preview/commit/duplicate/rejected auditはPR Bで実装する。

## Rollback

- applicationをbaseline imageへ戻しても既存tableと新規provenance table/dataを保持する。
- down migration、table drop、履歴削除、source file削除をrollback手順にしない。
- routesを旧applicationへ戻すことで新APIを無効化できる。既存Knowledge item/label/search/
  snapshot API契約は変更しない。

## Not verified / out of scope

- manual/JSON/Markdown import parser、preview/commit、idempotency（PR B）
- Knowledge Hub annotation/conversation/synthesis UI、real-backend E2E、screenshot（PR C）
- production migration、backup、restore、provider cutover
- Sakura VPS/systemd/Quadlet lifecycle
- real Google Drive/Sakura Object Storage/external LLM credentials or runtime
- annotation/synthesis/conversation full-text search expansion

PR A merge後もIssue #2013はopenのままとし、依存順にPR B、PR Cを実施する。
