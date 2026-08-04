# Issue #2010 Knowledge core schema / authorization / CRUD verification

- 実施日: 2026-08-04 JST
- branch: `feat/2010-knowledge-core-crud`
- migration / old-app compatibility test base: `origin/main` `73f79a62ec5ac00ebfd9a12b706b639bbfcc7070`
- final review base after dependency-only PR #2023: `origin/main` `ee34c7905cc2945e8cdf9643b58aa8a6d4eaafb2`
- 対象: Issue #2010 / Epic #2003 Workstream 02
- 検証種別: repository-side unit/integration、local ephemeral PostgreSQL。production/target-environment証跡ではない

## 実装範囲

- expand-only `KnowledgeItem` / `KnowledgeItemGroupGrant` schemaとmigration
- personal owner predicate、organization ID + active canonical group grant predicate
- repository port / Prisma adapter / application use case / Fastify CRUD API
- versionによるoptimistic concurrency、logical delete / restore
- business rowと`AuditLog`を同じPrisma transactionで確定するfail-closed audit writer
- canonical URLのcredential、fragment、tracking/secret query除去
- OpenAPI snapshot、backup/restore前提、bounded-context registry

## Security / privacy contract

- `admin` / `mgmt` roleだけでpersonal itemを通常閲覧しない
- list/detail/countは同一DB visibility predicateを使い、owner外IDは0 / `not_found`
- organization readはorg ID一致とactive group grant一致を両方要求する
- DB user context解決時はsigned tokenのstale organization claimをDB正本で置換し、DBにorganizationがなければclaimを消去する
- header authはdevelopment/testのsynthetic trust boundaryに限定し、production標準起動はenv validationで`jwt_bff`以外を拒否する
- organization grant変更とscope変更をgeneric PATCHへ含めない
- update/delete/restoreはowner + expected version一致を要求する
- audit metadataはscope/status/version/変更field名とboundedなprincipal/actor/scope provenanceだけを保存し、本文、URL、token ID、secretを保存しない
- provider URL、Drive/S3 credential、production identifierは使用していない

## Verification

| Command / check                                                   | Result | Notes                                                                                                                           |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| focused Knowledge tests                                           | PASS   | 25 tests: use case 8、Prisma adapter 6、route 7、schema/migration/OpenAPI 4                                                     |
| focused coverage                                                  | PASS   | adapter S/L/F 100%、B 84.74%；use case S/L 94.10%、B 73.61%、F 95.23%；route S/L 98.02%、B 73.33%、F 100%。閾値の追加・低下なし |
| empty PostgreSQL `prisma migrate deploy` / status                 | PASS   | PostgreSQL 15 pinned digestへ94 migrationsを適用、schema up to date                                                             |
| old-app compatibility                                             | PASS   | migration後DBへ`origin/main`の旧schema/client/applicationをbuildして接続し、`healthz=200` / `readyz=200`                        |
| local Prisma integration                                          | PASS   | personal/org ACL、URL正規化、version conflict、delete/restore、5 audit events、scope/version DB CHECK                           |
| `prisma validate`                                                 | PASS   | schema/migration整合                                                                                                            |
| `npm run lint --prefix packages/backend`                          | PASS   | Knowledge sourceを含む                                                                                                          |
| `npm run format:check --prefix packages/backend`                  | PASS   | Knowledge sourceを含む                                                                                                          |
| `npm run typecheck --prefix packages/backend`                     | PASS   | strict TypeScript                                                                                                               |
| `npm run build --prefix packages/backend`                         | PASS   | Prisma Client生成後                                                                                                             |
| `npm run test --prefix packages/backend`                          | PASS   | 1,525 tests、skip/todo 0                                                                                                        |
| `npm run coverage:auth:check --prefix packages/backend`           | PASS   | auth 151 tests。S/L 90.24%、B 70.88%、F 98.66%。既存閾値の低下なし                                                              |
| frontend lint / format / typecheck / build / test                 | PASS   | 82 files / 468 tests、backend変更による回帰なし                                                                                 |
| backend / frontend `npm audit --audit-level=high`                 | PASS   | PR #2023取込み後、いずれも0 vulnerabilities                                                                                     |
| `npm run arch:bounded-context --prefix packages/backend`          | PASS   | 274 modules / 1,050 dependencies、違反なし                                                                                      |
| `npm run arch:bounded-context:coverage --prefix packages/backend` | PASS   | contexts 11、unclassified/stale/duplicate/ambiguous 0                                                                           |
| OpenAPI export diff                                               | PASS   | `docs/api/openapi.json`と再生成結果が一致                                                                                       |
| `make ops-quality`                                                | PASS   | backup Runbook変更に対するdocs/scripts/Quadlet/S3/readiness checks                                                              |
| `git diff --check`                                                | PASS   | whitespace errorなし                                                                                                            |

## Migration / rollback

- 既存table/column/enumを削除・変更せず、新enumとKnowledge 2 table/index/FK/CHECKだけを追加する。
- 既存Chat tableにDDLを適用しないことをsource-level testで固定した。
- migration適用後DBで`origin/main`の旧Prisma schema/clientと旧applicationをbuild・起動し、health/readiness成功を確認した。
- application rollbackではKnowledge tableを保持したまま旧imageへ戻す。migration逆適用、table drop、物理削除は行わない。
- Workstream 02はbinary artifactを追加しない。Knowledge metadata/grant/auditは既存PostgreSQL backup対象となる。

## 未実施

- productionまたはSakura VPSへのmigration deploy
- production dataを用いたbackup/isolated restore
- UI実装/E2E（Workstream後続）
- label/search、snapshot/artifact、Chat share、external LLM
- migration deployとold-app compatibilityの再利用可能CI harness（#2024）

local ephemeral PostgreSQLは検証後に削除し、既存の停止済みPodman container/volume/networkには変更を加えていない。
