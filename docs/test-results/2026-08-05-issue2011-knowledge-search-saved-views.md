# Issue #2011 Knowledge search / saved views verification (PR2)

- 実施日: 2026-08-05 JST
- branch: `feat/2011-knowledge-search-saved-views`
- base: `476fab8d251e67481f7adcda1f8faaae666cafe1`
- 対象: Issue #2011 / Epic #2003 Workstream 03 PR2 (`Closes #2011`)
- 検証種別: repository-side unit/integration、local ephemeral PostgreSQL
- 非該当: production、Sakura VPS、target environment、実Google Drive/Sakura Object Storage credential

## PR2実装範囲

- ACL評価済みcanonical label rootを使うANY/ALL/NOT/descendant検索
- source/status/scope/published/captured filter、同じmatched setを使うtotal/facet
- `updatedAt DESC, id DESC`の安定順序と、query/actor scopeへ束縛したHMAC署名cursor
- visible labelとcurrent effective assignmentだけを使う、正規化後2文字以上の候補API
- owner-only保存ビューCRUD/実行、current ACL再検証、stale viewのfail-closed実行とfilter非公開recovery metadata
- canonical label解決、descendant展開、検索実行を同じRepeatable Read snapshotへ束縛し、保存時再検証とwrite/auditを同じSerializable transactionへ束縛
- query-cost上限、parameterized SQL、一定エラー、raw filter/label IDを共有監査へ保存しないprivacy境界
- additive search index migration、OpenAPI、env validation、運用・要件文書

## Security / privacy contract

- cursorはversion、順序key、filter hash、actor-scope fingerprintをHMAC-SHA256で署名し、改ざん、別filter、別principal/group scope、形式不正を一定の`invalid_cursor`で拒否する。
- productionでは32 UTF-8 byte以上の`KNOWLEDGE_CURSOR_SIGNING_SECRET`を必須とする。non-production未設定時だけprocess-local random secretを使う。
- 検索SQLはcurrent item ACL、current label ACL、非削除label、active assignmentを同じstatementで評価する。hidden/deleted/revoked relationはitems、total、facets、suggestionsへ出さない。search/suggestion/saved-view executeには既存`RATE_LIMIT_SEARCH_*`契約を使う個別制限（既定60 requests / minute）を適用する。
- saved viewはowner-onlyであり、作成・更新時にcanonical root、current ACL、descendant展開、expanded ID上限をbusiness writeと同じSerializable transaction内で再検証する。list/detail/execute時にACLが失効したviewはfilter情報を返さず`invalid_saved_view`とし、別のrecovery APIもlabel/filterを返さず`id|name|version|updatedAt`だけを返す。DELETE成功時は`204 No Content`とし、staleな旧filterやcanonical label IDを応答へ戻さない。
- saved-view監査は一定targetとschema/versionだけを記録し、label ID、query、filter body、cursor、group principalを共有監査metadataへ保存しない。
- synthetic fixtureとloopback ephemeral PostgreSQLだけを使用し、production identifier、credential、provider URL、個人情報は使用していない。

## Focused verification

| Command / check                                     | Result | Evidence                                                                                                                             |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Prisma generate / backend typecheck / build         | PASS   | strict TypeScriptとOpenAPI再生成がexit 0                                                                                             |
| focused cursor/search/saved-view unit + route tests | PASS   | 68 tests、fail/skip/todo 0。snapshot、recovery metadata、Serializable retry、scalar-only label facet、3経路のrate-limit wiringを含む |
| PostgreSQL 15 integration                           | PASS   | `items=305`、`assignments=308`、`views=1`、`audits=2`、equal-timestamp 3 pages、plan indexes 2                                       |
| migration deploy / status                           | PASS   | 空のephemeral DBへ全migrationを適用し、schema up to date                                                                             |
| search semantics / ACL                              | PASS   | ANY descendant、ALL root-wise、NOT、detached/hidden除外、facet/suggestion current ACL                                                |
| cursor pagination                                   | PASS   | 同一timestampを含む3 pagesで重複・欠落0                                                                                              |
| saved-view ACL / audit privacy                      | PASS   | revoke後`invalid_saved_view`、filter非公開recovery metadata、stale owner delete、audit metadata allowlist                            |
| query plan                                          | PASS   | synthetic fixtureで新規KnowledgeItem / active assignment indexの利用を確認                                                           |
| integration shell syntax / safety                   | PASS   | pinned PostgreSQL 15 digest、loopback ephemeral port、production/external接続なし                                                    |
| backend lint                                        | PASS   | backend ESLint exit 0                                                                                                                |
| OpenAPI export                                      | PASS   | sourceから`docs/api/openapi.json`を再生成し新規pathを確認                                                                            |
| focused source coverage                             | PASS   | 対象9 compiled modules、64 testsでS/L 95.61%、B 73.69%、F 96.36%                                                                     |
| `git diff --check`                                  | PASS   | whitespace error 0                                                                                                                   |

### PostgreSQL integration summary

```json
{
  "result": "PASS",
  "items": 305,
  "assignments": 308,
  "views": 1,
  "audits": 2,
  "equalTimestampPages": 3,
  "planIndexes": 2
}
```

これはsynthetic fixtureの集計であり、production件数やidentifierを含まない。ephemeral PostgreSQL containerは検証後に停止・削除し、persistent volume/networkは作成していない。

## Independent review remediation

- Codex P1で、stale viewのDELETE成功応答が旧filterをserializeし、通常readの`invalid_saved_view`境界を迂回してcanonical label IDを返し得ることを検出した。DELETE成功をbodyなしの`204 No Content`へ変更し、service fakeがstale label IDを返してもHTTP bodyが空であるroute test、OpenAPI、要件を同期した。修正後はfocused cursor/search/saved-view 64 tests、backend full 1681 tests、lint/format/typecheck/build、OpenAPI non-breaking diff、docs checkがPASSした。
- staleな通常list/detailは固定契約どおりgeneric `invalid_saved_view`を維持しつつ、新しい端末からもownerが回復できるfilter非公開recovery metadata APIを追加した。
- ad-hoc searchはlabel reference resolve、current-visible descendant expansion、single search statementを同じRepeatable Read transactionへ統合した。
- saved-view create/updateは新filterのroot visibility、descendant expansion/self path、visible expanded ID 100上限、business write、allowlist auditを同じSerializable transactionで評価し、P2034/40001/40P01等を最大3回retryする。
- label facetの有効なfilter組合せは維持しつつsearch/suggestion/saved-view executeへ個別rate limitを適用し、suggestionは正規化後1文字を`invalid_request`として低選択率scanを制限した。
- cursor envelopeの`actorScopeFingerprint`はIssueの固定契約であるため維持した。値はraw principalではなくsecret-keyed HMACで、cursor全体もHMAC認証する。

## Repository-wide quality gates

| Gate                                              | Result  | Notes                                                 |
| ------------------------------------------------- | ------- | ----------------------------------------------------- |
| backend format / typecheck / build / full test    | PASS    | backend 1681 tests、fail/skip/todo 0                  |
| exact old-application compatibility               | PASS    | PR1 exact appからmigration 94→96、既存data/CRUDを確認 |
| bounded-context architecture / coverage           | PASS    | 288 modules / 1115 dependencies、unclassified 0       |
| frontend lint / format / typecheck / build / test | PASS    | 82 files / 468 tests                                  |
| `make ops-quality`                                | PASS    | profile / S3 / storage-readinessを含む                |
| backend/frontend audit                            | PASS    | high threshold、0 vulnerabilities                     |
| docs index / image links                          | PASS    | index 2 tests、115 links / 347 markdown files         |
| OpenAPI export consistency / breaking diff        | PASS    | export byte-identical、breaking differenceなし        |
| repository secret scan                            | PASS    | staged新規fileを含む1894 tracked files、match 0       |
| exploratory core release-readiness                | PASS    | `--allow-dirty`、全29 checks、E2E 105 tests           |
| exact-head GitHub Actions / CodeQL / Link Check   | PENDING | push後のexact headで確認する                          |
| independent correctness/security review           | PASS    | correctness / securityともfinding 0                   |
| exact-head Copilot review / unresolved threads    | PENDING | PR作成後のexact headで確認する                        |

通常の`make release-readiness`は仕様どおりdirty worktreeのclean-checkout
preflightで停止した。そのため公式release証跡とはせず、候補差分の探索的確認として
`RELEASE_E2E_SCOPE=core node scripts/release-readiness.mjs --allow-dirty`を実行した。
repo-side 29 checksとcore E2E 105 testsは全てPASSしたが、GitHub Actionsと対象環境の
Go判定を代替する証跡ではない。E2E用PostgreSQL containerとhost listenerは実行後に
停止・削除した。

## Migration / rollback

- migrationは既存rowを更新・削除せず、検索用indexだけを追加する。旧indexも保持する。
- application rollbackでは新indexとPR1のlabel/saved-view tableを保持したままPR1 imageへ戻す。migration逆適用、index/table drop、row物理削除は行わない。
- cursor signing secretを変更すると発行済みcursorは一定の`invalid_cursor`となるため、通常rollbackでは同じsecretを維持する。
- 保存ビューはPR1 schemaを利用し、PR2でschema model/table/column契約を変更しない。

## 未実施・非対象

- production/Sakura VPSへのmigration deploy
- production dataを用いた性能測定、backup、isolated restore
- systemd/Quadlet lifecycle
- Google Drive/Sakura Object Storage実credentialとprovider operation
- frontend検索・保存ビューUI/E2E
- vector/semantic search、AI自動label

repository-side検証をtarget-environment成功として扱わない。実環境migration/backup/restoreは別Issueのsecure input、人間承認、sanitized evidence境界に従う。
