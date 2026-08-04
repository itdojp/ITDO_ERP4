# Issue #2011 Knowledge label core verification (PR1)

- 実施日: 2026-08-05 JST
- branch: `feat/2011-knowledge-label-core`
- base / old-app compatibility artifact: `358cb9e4d13489b703cb71cfee4b2754d15aa53e`
- 対象: Issue #2011 / Epic #2003 Workstream 03 PR1 (`Refs #2011`)
- 検証種別: repository-side unit/integration、local ephemeral PostgreSQL
- 非該当: production、Sakura VPS、target environment、実Google Drive/Sakura Object Storage credential

## PR1実装範囲

- expand-onlyのlabel/alias/closure-path/item-label/`use|manage` group-grant/saved-view/filter schemaとmigration
- personal owner-only、organization一致 + active明示grantのlabel visibility/use、ownerまたは`manage`によるmaster mutation
- label CRUD、alias追加/削除、closure-path reparent、grant全置換、item attach/detach
- item owner/versionとlabel useを同じserializable transactionで評価するassignment境界
- business writeとallowlist `AuditLog`を同じtransactionで確定するfail-closed監査
- label masterの一定audit targetと、raw label ID/name/alias/filterを共有監査へ保存しないprivacy境界
- Fastify routeとOpenAPI snapshot。public attachはmanual assignmentだけを許可し、import/AI provenanceは信頼済み内部portへ限定
- additive migration、旧Workstream 02 application互換、backup/rollback前提

PR2へ残す範囲はANY/ALL/NOT検索、descendant filter、ACL済みcount/facet/suggestion、query-cost guard、query/scope-bound signed cursor、saved-view runtime APIである。PR1はIssue #2011をcloseしない。

## Security / privacy contract

- JWT/sessionのowner/audit principalはWorkstream 02と同じstable canonical `UserAccount.id`を使い、raw token subject/legacy mutable identifierへfallbackしない。
- personal labelはownerのみ。organization labelのuseはorganization一致とactive `use|manage`、master mutationは同一organizationのownerまたはactive `manage`を要求する。
- hidden、logical deleted、grant revoked、cross-domain、absent labelは同じ`404 not_found`で非列挙化する。
- reparentはsubtree/pathをlockし、self path、cycle、domain、最大depth 8、broken pathをtransaction内で検証する。
- label master audit targetは`knowledge_labels` / `label_master`の一定markerとする。label ID/name/slug/alias、grant principal、検索語/filter bodyは共有監査metadataへ保存しない。
- item-label監査は認可済みitemだけをtargetにし、label IDをmetadataへ保存しない。監査失敗はbusiness mutationもrollbackする。
- production identifier、provider URL、Drive/S3 credential、外部接続は使用していない。

## Focused verification

| Command / check                               | Result | Evidence                                                                                                                           |
| --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Prisma Client generate / schema validate      | PASS   | 7 model / enum / relation / CHECK / index contractを検証                                                                           |
| backend TypeScript typecheck / build          | PASS   | strict TypeScript、OpenAPI再生成に使用                                                                                             |
| focused Knowledge item + label tests          | PASS   | 54 tests、fail/skip/todo 0。schema/migration/OpenAPI/harness 13、adapter 10、route 6、use case 12、既存Knowledge item route 13     |
| PostgreSQL 15 integration                     | PASS   | fixed digest、tmpfs、loopback ephemeral port。`labels=14`、`paths=51`、`assignments=1`、`labelAudits=21`、`maxDepth=8`             |
| migration deploy / status                     | PASS   | 空DBへ全migration適用後、schema up to date                                                                                         |
| hierarchy/ACL transaction checks              | PASS   | cycle、cross-domain、depth 8許可/depth 9拒否、personal/org ACL、use vs manage、attach/detach、grant revoke、audit failure rollback |
| concurrency / lock non-enumeration            | PASS   | 同一slug同時確保、逆向きreparent、同時attach/detachを競合正規化。権限外label/item requestは既存row lockを待たず同じnot-found       |
| DB CHECK negative checks                      | PASS   | assignment confidence contract、scope/owner/org、closure self/depth、version/normalization                                         |
| audit privacy check                           | PASS   | label master target一定、raw label ID不在、失敗監査時rollback                                                                      |
| integration shell syntax / safety source test | PASS   | pinned image、tmpfs、ephemeral container、volume/system resetなし                                                                  |
| focused source coverage                       | PASS   | statements 65.53%、branches 66.44%、functions 69.13%、lines 65.53%、28 tests、fail/skip/todo 0                                     |
| `git diff --check`                            | PASS   | tracked/new 23 filesをstagingしたfinal candidateでwhitespace error 0                                                               |

### PostgreSQL integration summary

```json
{
  "result": "PASS",
  "labels": 14,
  "paths": 51,
  "assignments": 1,
  "labelAudits": 21,
  "maxDepth": 8
}
```

この値はsynthetic fixtureの集計であり、production件数やidentifierを含まない。ephemeral PostgreSQL containerは検証後に停止・削除され、persistent volume/networkは作成していない。

## Exact old-app compatibility

tracked harness `./scripts/test-knowledge-label-old-app.sh`を使い、次の順序で48.236秒で検証した。

1. exact Workstream 02 merge artifact `358cb9e4d13489b703cb71cfee4b2754d15aa53e`の94 migrationsを空のPostgreSQL 15へ適用
2. 旧applicationで代表的なWS02 `KnowledgeItem`を作成
3. PR1 migrationを適用しmigration数95を確認
4. 既存WS02 rowが保持されることを確認
5. exact旧artifactのPrisma Client/applicationを生成・buildし、拡張後DBへ接続
6. list/count/detail/update/delete/restore、`healthz`、`readyz`を検証

結果:

```json
{"result":"PASS","baseline":"358cb9e4d13489b703cb71cfee4b2754d15aa53e","crudFinalVersion":4,"healthz":200,"readyz":200}
{"oldMigrations":94,"newMigrations":95,"existingWs02DataRetained":true}
```

exact old artifactは`git archive`でrepository内の`.codex-local/tmp/`へ展開し、ephemeral containerとscratch treeは検証後に削除した。`/tmp`、追加worktree、persistent Podman volume/network、`rm -rf`、`git reset/clean`は使用していない。検証後にmatching container/scratch directoryが0件であることを確認した。既存repository/worktreeの未コミット変更は変更・破棄していない。

## Repository-wide quality gates

| Gate                                              | Result  | Notes                                                                                             |
| ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| backend lint / format / typecheck / build         | PASS    | 全てexit 0                                                                                        |
| backend full test                                 | PASS    | 1,602 tests、fail/skip/todo 0                                                                     |
| bounded-context architecture / coverage           | PASS    | dependency-cruiser 279 modules / 1,069 dependencies、source 264 / target 221、未分類・重複・違反0 |
| frontend lint / format / typecheck / build / test | PASS    | 82 files / 468 tests、fail 0                                                                      |
| `make ops-quality`                                | PASS    | ops docs/scripts、Quadlet/profile、backup/storage-readiness testsを含む                           |
| backend/frontend audit                            | PASS    | 両packageとも0 vulnerabilities、dependency変更なし                                                |
| docs index / image links                          | PASS    | index生成test/check、115 image links / 346 markdown files                                         |
| OpenAPI export consistency / diff                 | PASS    | source再生成snapshotとbyte-identical、`openapi-diff` breaking change 0                            |
| changed-diff secret scan                          | PASS    | 23 changed/new filesでprivate key、AWS/GitHub/Google token、Bearer JWTのhigh-confidence pattern 0 |
| exact-head GitHub Actions / CodeQL / Link Check   | PENDING | Draft PR作成後に確認                                                                              |
| independent correctness/security/Copilot review   | PENDING | exact head、unresolved thread 0を要求                                                             |

## Migration / rollback

- migrationは新enum/table/index/FK/CHECKだけを追加し、既存table/column/rowを削除・更新しない。
- `KnowledgeItem`と`GroupAccount`にはPrisma relation fieldだけを追加し、対応tableのDDLを変更しない。
- old appが拡張後DBでCRUD/health/readinessを維持することを上記exact artifactで確認した。
- application rollbackでは新label/saved-view tableとenumを保持したままWorkstream 02 imageへ戻す。migration逆適用、table drop、row物理削除は行わない。
- PR1の全metadata/grant/path/assignment/auditは既存PostgreSQL backup bundleの対象となる。binary/provider objectは追加しない。

## 未実施・非対象

- production/Sakura VPSへのmigration deploy
- production dataを用いたbackup/isolated restore
- systemd/Quadlet lifecycle
- Google Drive/Sakura Object Storage実credentialとprovider operation
- frontend label UI/E2E
- ANY/ALL/NOT検索、facet/suggestion、signed cursor、saved-view API（PR2）
- vector/semantic search、AI自動label

local repository-side検証をtarget-environment成功として扱わない。実環境migration/backup/restoreは別Issueのsecure input、人間承認、sanitized evidence境界に従う。
