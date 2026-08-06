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
  再検査し、失効したsource identity/bodyを返さない。
- mutation、version/idempotency確定、mandatory Knowledge auditを同一transactionで処理し、
  audit metadataへ本文、prompt、URL、provider/request key、raw errorを入れない。
- listはstable sort、bounded limit、actor/resource/parentへ束縛したHMAC署名付きopaque
  cursorを使用する。
- migrationはexpand-onlyで、既存table/column/dataをdrop、rename、更新しない。

## Focused tests

| Verification                                        | Result | Evidence                                                                                                                        |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| provenance schema / constraint / migration contract | PASS   | explicit enum、content/version/hash/scope bounds、exactly-one FK、single primary、expand-only、OpenAPI assertions               |
| signed cursor                                       | PASS   | actor/resource/parent/sort binding、tamper rejection、production secret requirement                                             |
| application use cases                               | PASS   | annotation history/delete/audit rollback、cross-owner relation、role-origin、turn/version conflict、source validation/redaction |
| Prisma adapter                                      | PASS   | ACL intersection DB predicate、item-first ACL、audit action/target/metadata allowlist、transaction conflict normalization       |
| route contract                                      | PASS   | canonical actor、allowlisted response、unknown-field rejection、sanitized not-found、provenance redaction                       |

Result: **31/31 PASS**（fail/skip/todo 0）

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
- concurrent turn append: one success / one conflict
- concurrent synthesis version: one success / one conflict
- synthesis source exactly-one CHECK rejects zero/two references
- source logical deletion causes provenance redaction
- mandatory audit failure rolls back the business mutation
- audit rows contain no annotation/turn/synthesis bodies
- migration deploy/status succeeded

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

| Gate                                      | Result  | Notes                                                                                                         |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| Prisma format/generate                    | PASS    | Prisma 7.9.1                                                                                                  |
| root lint / format / typecheck / build    | PASS    | backend/frontend。frontend dev dependenciesはlockfile準拠の`npm ci`後に実行                                   |
| `make test`                               | PASS    | backend 1,846/1,846、frontend 85 files / 495 tests。fail/skip/todo 0                                          |
| focused coverage                          | PASS    | executed files aggregate: statements/lines 70.38%、branches 62.23%、functions 58.88%。threshold/scope変更なし |
| bounded-context dependency/coverage       | PASS    | 306 modules / 1,203 dependencies、291 source files、243 targets、unclassified/duplicate/ambiguous 0           |
| OpenAPI export / breaking diff            | PASS    | generated snapshotとtracked fileはbyte-identical。baselineからbreaking 0、18 operation追加のみ                |
| `make ops-quality`                        | PASS    | live systemd/provider操作なし。S3 profile 22/22、storage readiness 2/2を含む                                  |
| backend/frontend security audit           | PASS    | `npm audit --audit-level=high`: 0 vulnerabilities / 0 vulnerabilities                                         |
| docs index / image links                  | PASS    | index current、118 image links / 351 Markdown files                                                           |
| secret scan / `git diff --check`          | PASS    | candidate filesを含むtracked scan 0 match、whitespace error 0                                                 |
| independent/Copilot review / CI / cooling | PENDING | Draft PR作成後にexact headで確認する                                                                          |

Focused coverageのうち、infrastructure adapterはc8計測でstatements/lines 39.10%、
branches 53.92%、functions 41.81%だった。実DB経路は上記のPostgreSQL 15 integrationで
追加検証している。coverage threshold、対象scope、ignore、skipは変更していない。

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
