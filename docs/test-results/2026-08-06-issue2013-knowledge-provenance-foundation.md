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
- annotation/conversationの全readをRepeatable Read transactionで実行し、そのsnapshotを
  認可線形化点とする。annotation本文queryとconversation relation/turn query自身にもparent
  item ACL predicateを含める。snapshot後にgrant revokeとownerによる履歴追加を挟む
  PostgreSQL 15実統合試験で、失効後の新規本文がresponseへ混在しないことを確認した。
- conversation-itemの同一owner制約をapplication検査と、relation内部の`ownerUserId`から両親の
  `(id, ownerUserId)`へ張る2本のdeferrable composite FKで保証する。Prisma直接insert、片親だけの
  owner更新、relation insertと親owner更新の並行競合をDBが拒否し、両親を同一transactionで同じ
  ownerへ移す整合した更新だけを許可する。
- mutation、version/idempotency確定、mandatory Knowledge auditを同一transactionで処理し、
  audit metadataへ本文、prompt、URL、provider/request key、raw errorを入れない。複数source
  ACLはread/mutationとも一つのRepeatable Read snapshotで評価し、grant swapによる時点混在を
  防ぐ。
- provenance mutation auditはcanonical principal、実行actor、scope、token/audience/expiry、
  request、agent runの型付きallowlistだけを保持する。必須principal/actor/request/sourceが欠落・
  不正な場合はauditをfail closedにし、業務mutationもrollbackする。scopeは100件・各255文字、
  `A-Z a-z 0-9 . _ ~ : / -`に限定し、URI path形式は維持する。JWT/configと監査adapterで同じ
  validatorを使い、Unicode制御・bidi文字、userinfo、query、fragmentをfail closedとする。
- annotation revision、conversation turn、synthesis version/sourceは新規table専用triggerで
  update/deleteを拒否し、API経路外でもimmutable historyを保つ。
- listはstable sort、bounded limit、actor/resource/parentへ束縛したHMAC署名付きopaque
  cursorを使用する。history cursorはPostgreSQL `INTEGER`最大sequenceを往復でき、incrementを
  伴うmutationの`expectedVersion`上限とは分離する。
- migrationはexpand-onlyで、既存table/column/dataをdrop、rename、更新しない。

## Focused tests

| Verification                                        | Result | Evidence                                                                                                                       |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| provenance schema / constraint / migration contract | PASS   | explicit enum、content/version/hash/scope bounds、exactly-one FK、single primary、expand-only、OpenAPI assertions              |
| delegated auth scope contract                       | PASS   | URI path保持、100/101件、255/256文字、trim/deduplicate、Unicode control/bidi/query/userinfo拒否                                |
| signed cursor                                       | PASS   | actor/resource/parent/sort binding、tamper rejection、production secret requirement                                            |
| application use cases                               | PASS   | annotation/conversation read snapshot、history/delete/audit rollback、cross-owner relation、role-origin、turn/version conflict |
| Prisma adapter                                      | PASS   | Repeatable Read、ACL intersection、depth-aware memo/cycle/budget、200件境界、same-aggregate拒否、source-less fail-close        |
| route contract                                      | PASS   | canonical actor、signed cursor、401内部reason除去、unknown-field rejection、budget時のnon-disclosing empty/404                 |

Result: **66/66 PASS**（provenance 59 + delegated auth scope 7、fail/skip/todo 0）

Focused command:

```bash
cd packages/backend
node scripts/run-tests.js \
  test/authDelegated.test.js \
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
- annotation historyのRepeatable Read snapshot後にgrant revokeとrevision追加を挟んでも
  revoke後の本文を混在させない
- conversation turnのRepeatable Read snapshot後にgrant revokeとturn追加を挟んでも
  revoke後の本文を混在させない
- linked relation存在中の片親owner更新をcomposite FKが拒否
- 両親を同一transactionで同じownerへ移す整合更新ではrelation ownerもcascade追従
- relation insertと親owner更新の並行競合では、owner更新transactionがPostgreSQLの
  `Lock`待ちへ入ったことを別connectionから観測してから先行transactionをcommitし、
  不整合なowner更新を拒否
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
- audit rows retain typed principal/actor/scope/request attribution
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
| `make test`                               | PASS    | backend 1,875/1,875、frontend 85 files / 495 tests。fail/skip/todo 0                                                             |
| focused coverage                          | PASS    | provenance files aggregate: statements/lines 82.61%、branches 70.44%、functions 89.24%。threshold/scope変更なし                  |
| bounded-context dependency/coverage       | PASS    | 309 modules / 1,212 dependencies、294 source files / 245 targets、unclassified/duplicate/ambiguous 0                             |
| OpenAPI export / breaking diff            | PASS    | generated snapshotとtracked fileはbyte-identical。baselineからbreaking 0、18 operation追加のみ                                   |
| `make ops-quality`                        | PASS    | live systemd/provider操作なし。S3 profile 22/22、storage readiness 2/2を含む                                                     |
| backend/frontend security audit           | PASS    | `npm audit --audit-level=high`: 0 vulnerabilities / 0 vulnerabilities                                                            |
| docs index / image links                  | PASS    | index current、118 image links / 351 Markdown files                                                                              |
| secret scan / `git diff --check`          | PASS    | candidate filesを含むtracked scan 0 match、whitespace error 0                                                                    |
| independent/Copilot review / CI / cooling | PENDING | Repeatable Read、depth memo、200件境界、same-aggregate/immutable DB保証を追加修正済み。final exact headで再review/CI/coolingする |

Focused coverageのうち、main infrastructure adapterはc8計測でstatements/lines 67.67%、
branches 68.27%、functions 79.31%、audit adapterはstatements/lines 90.99%、branches
78.88%、functions 100%、shared auth scope validatorはstatements/lines 92.50%、branches
76.47%、functions 100%、request access contextはstatements/lines/functions 100%、branches
50.00%だった。実DB経路は
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
- 既存`KnowledgeItem`への非CONCURRENT composite unique index作成時間とwrite lock時間。
  production適用前に実data規模で測定する
- Sakura VPS/systemd/Quadlet lifecycle
- real Google Drive/Sakura Object Storage/external LLM credentials or runtime
- annotation/synthesis/conversation full-text search expansion

PR A merge後もIssue #2013はopenのままとし、依存順にPR B、PR Cを実施する。
