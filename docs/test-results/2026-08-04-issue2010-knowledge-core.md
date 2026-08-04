# Issue #2010 Knowledge core schema / authorization / CRUD verification

- 実施日: 2026-08-04 JST
- branch: `feat/2010-knowledge-core-crud`
- migration / old-app compatibility test base: `origin/main` `ee34c7905cc2945e8cdf9643b58aa8a6d4eaafb2`
- final review base after dependency-only PR #2023: `origin/main` `ee34c7905cc2945e8cdf9643b58aa8a6d4eaafb2`
- 対象: Issue #2010 / Epic #2003 Workstream 02
- 検証種別: repository-side unit/integration、local ephemeral PostgreSQL。production/target-environment証跡ではない

## 実装範囲

- expand-only `KnowledgeItem` / `KnowledgeItemGroupGrant` schemaとmigration
- personal owner predicate、organization ID + active canonical group grant predicate
- repository port / Prisma adapter / application use case / Fastify CRUD API
- versionによるoptimistic concurrency、logical delete / restore
- business rowと`AuditLog`を同じPrisma transactionで確定するfail-closed audit writer
- canonical URLのuserinfo、安全なfragment、tracking queryを除去する一方、credential-like queryはrequest全体を拒否する。署名URLの`key` / `policy` / `expires`、OAuthの`state` / `code`は値が一見無害でもfail-closedで拒否する。OAuth assertion/verifier/proof系とSAML request/artifact/relay-state系を含むquery名を検査し、query値も入力長でboundedに多重percent-decodeして、先頭のcredential-like `name=value`を安全なouter query名の配下でも拒否する。malformed prefix、先頭slashのないpath-relative URL、semicolon/encoded delimiter、入れ子およびtop-level hash-router fragment内のcredential query textを同じdecoderで検査する。解析上限到達はfail closedとし、正規化後の過大URLも拒否する
- OpenAPI snapshot、backup/restore前提、bounded-context registry

## Security / privacy contract

- `admin` / `mgmt` roleだけでpersonal itemを通常閲覧しない
- list/detail/countは同一DB visibility predicateを使い、owner外IDは0 / `not_found`
- organization readはorg ID一致とactive group grant一致を両方要求する
- JWT/sessionのDB user context解決時はsigned tokenのstale organization/group claimをDB正本で置換し、group由来roleもDB groupだけから導出する。DBにorganizationがなければclaimを消去する
- header authはdevelopment/testのsynthetic trust boundaryに限定し、DB canonical化を行わない。production標準起動はenv validationで`jwt_bff`以外を拒否する
- TTL付きDB auth context cacheはSCIMと手動group/membership mutationで成功直後に全消去し、membership失効後のorganization read/createとgroup由来roleを同一processで再利用しない。分散invalidation未実装の複数backend instanceではTTL 0を要求する
- organization grant変更とscope変更をgeneric PATCHへ含めない
- update/delete/restoreはowner + expected version一致を要求する
- application service境界でもmutable fieldのruntime型・enum・明示的`undefined`、RFC 3339 date-time、routeと同じ文字数/organization grant集合/list/item ID/DB `INTEGER`をincrement可能なexpectedVersion上限（2,147,483,646）、および削除理由型を検証する。routeを迂回した過大payload・locale依存日時・trim後重複grant・Prisma range/overflow error・`TypeError`を防止する。正規化後の同一値だけを含むPATCHは`400 invalid_request`としてversion/auditを進めず、実変更との混在時は実変更fieldだけを更新・監査する
- audit metadataはscope/status/version/変更field名だけを保存し、本文、URL、token ID、secretを保存しない。actor provenanceは認可済み`userId`、安全文字・128文字上限をadapterでも再検証したrequest ID、有限値`api|agent`のsourceだけに限定する。raw role/group display name/scope/IP/User-AgentはKnowledge audit port/DBへ渡さない
- logical deleteの`reasonCode`はrequest/response schema、application port/service、具象Prisma adapter、Knowledge audit writer、DB enum/CHECKの各境界で有限allowlist（`owner_request`）へ限定し、serviceを迂回しても任意文やcredentialをbusiness row / auditへ保存しない
- provider URL、Drive/S3 credential、production identifierは使用していない

## Verification

| Command / check                                                   | Result | Notes                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| focused Knowledge tests                                           | PASS   | 37 tests: use case 16、Prisma adapter 9、route 8、schema/migration/OpenAPI 4。use case内でcredential root 16種 × encoding 4種 × 配置3種の192-case embedded-value matrixをcreate/update双方へ適用 |
| auth cache invalidation focused                                   | PASS   | 3 subprocess tests: TTL有効時の手動membership削除、group rename/deactivate。失効後Knowledge list/count/detail/createも確認                                                                       |
| focused coverage                                                  | PASS   | adapter S/L/F 100%、B 87.01%；use case S/L 96.97%、B 88.12%、F 97.43%；route S/L 99.47%、B 77.14%、F 100%。閾値の追加・低下なし                                                                  |
| empty PostgreSQL `prisma migrate deploy` / status                 | PASS   | PostgreSQL 15 pinned digestへ94 migrationsを適用、schema up to date                                                                                                                              |
| existing shared-audit conflict migration                          | PASS   | base migrations後に衝突fixtureを入れても`NOT VALID`追加成功。既存1件を保持し、新規invalid拒否・allowlisted write許可                                                                             |
| old-app compatibility                                             | PASS   | migration後DBへ`origin/main`（`ee34c790`）の旧schema/client/applicationをbuildして接続し、`healthz=200` / `readyz=200`                                                                           |
| local Prisma integration                                          | PASS   | personal/org ACL、URL正規化、version conflict、delete/restore、5 audit events、scope/version/deletion reason/audit reason DB CHECK                                                               |
| `prisma validate`                                                 | PASS   | schema/migration整合                                                                                                                                                                             |
| `npm run lint --prefix packages/backend`                          | PASS   | Knowledge sourceを含む                                                                                                                                                                           |
| `npm run format:check --prefix packages/backend`                  | PASS   | Knowledge sourceを含む                                                                                                                                                                           |
| `npm run typecheck --prefix packages/backend`                     | PASS   | strict TypeScript                                                                                                                                                                                |
| `npm run build --prefix packages/backend`                         | PASS   | Prisma Client生成後                                                                                                                                                                              |
| `npm run test --prefix packages/backend`                          | PASS   | 1,540 tests、skip/todo 0                                                                                                                                                                         |
| `npm run coverage:auth:check --prefix packages/backend`           | PASS   | auth 151 tests。S/L 90.24%、B 71.03%、F 98.66%。既存閾値の低下なし                                                                                                                               |
| frontend lint / format / typecheck / build / test                 | PASS   | 82 files / 468 tests、backend変更による回帰なし                                                                                                                                                  |
| backend / frontend `npm audit --audit-level=high`                 | PASS   | PR #2023取込み後、いずれも0 vulnerabilities                                                                                                                                                      |
| `npm run arch:bounded-context --prefix packages/backend`          | PASS   | 274 modules / 1,051 dependencies、違反なし                                                                                                                                                       |
| `npm run arch:bounded-context:coverage --prefix packages/backend` | PASS   | contexts 11、unclassified/stale/duplicate/ambiguous 0                                                                                                                                            |
| OpenAPI export diff                                               | PASS   | `docs/api/openapi.json`と再生成結果が一致                                                                                                                                                        |
| `make ops-quality`                                                | PASS   | backup Runbook変更に対するdocs/scripts/Quadlet/S3/readiness checks                                                                                                                               |
| `git diff --check`                                                | PASS   | whitespace errorなし                                                                                                                                                                             |

## Migration / rollback

- 既存table/column/enumを削除・型変更せず、新enumとKnowledge 2 table/index/FK/CHECK、および共用`AuditLog`のKnowledge削除actionだけを拘束する条件付きCHECKを追加する。共有CHECKは`NOT VALID`で既存row走査を避けつつ新規writeへ適用し、private read-only preflight 0件、lock/statement timeoutを含む人間の変更承認、別sessionでのvalidation、cancel/error時のrollbackをRunbookへ分離した。既存行の更新・削除は行わない。
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
- 権限拒否、hidden/absent、version conflict、route/schema denialのprivacy-preserving failure audit（#2025。成功mutationの同一transaction監査は本PRで実装済み）
- 複数backend instance間のDB user context cache分散invalidation（#2026。実装までは全instanceでTTL 0が必須）

local ephemeral PostgreSQLは検証後に削除し、既存の停止済みPodman container/volume/networkには変更を加えていない。
