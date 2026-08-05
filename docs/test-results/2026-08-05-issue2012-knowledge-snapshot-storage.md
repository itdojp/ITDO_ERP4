# Issue #2012 Knowledge snapshot storage verification (PR A)

- 実施日: 2026-08-05 JST
- branch: `feat/2012-knowledge-snapshot-storage`
- base: `d4ef000154c46e0b117495d39e8bea1f2ea204e2`
- 対象: Issue #2012 / Epic #2003 Workstream 04 PR A (`Refs #2012`)
- 検証種別: repository-side unit/integration、local ephemeral PostgreSQL、local artifact storage
- 非該当: production、Sakura VPS、target environment、実Google Drive/Sakura Object Storage credential、provider cutover

## PR A実装範囲

- `KnowledgeItem`配下のappend-only `KnowledgeSnapshot`と、item内version、SHA-256、provenance、`pending` / `ready` / `failed`状態を追加
- ownerを`knowledge_snapshot` / snapshot IDへ内部固定するKnowledge専用artifact portを追加
- DB intent確定、transaction外のbounded capture/store、別transactionのCAS finalize/auditという副作用順序を実装
- result-unknown時に外部createを繰り返さず、既存artifactのowner/hash/size/typeを照合するread-only reconciliationを追加
- text、URL、PDF、image captureのsize/type/timeout/redirect/private IP/active-content境界を追加
- item ACLとsnapshot relation/statusを再評価してdownloadし、provider URL/keyをAPIへ返さない経路を追加
- localまたは既存の共有Google Drive adapterを選択するKnowledge context設定、env validation、OpenAPI、運用・要件文書を追加
- additive Prisma migration、実PostgreSQL統合test、fake/local unit testを追加

manual capture UI、frontend E2E、sanitized screenshot evidenceは、PR A merge後のPR B（`Closes #2012`）で実装する。

## Security / privacy contract

- append/reconcileはcurrent item ownerだけ、list/detail/downloadはcurrent item ACLとsnapshot relationを同時に検証する。captureはartifact I/Oの前後、reconcile/downloadはprovider I/Oの直前と直後にもACLを再確認し、I/O後checkまでに失効した場合は内容または成功を返さない。
- client request key、owner user ID、item IDから内部SHA-256 namespaceを生成し、raw値をprovider metadata、idempotency key、errorへ出さない。認可済みERP4 APIの`capturedBy`とaudit actorには、既存Knowledge provenance契約どおりcanonical account IDを使用する。
- URL captureはcredential入りURL、非HTTP(S)、private/loopback/link-local address、redirect逸脱、許可外content type、宣言/実測size超過、body timeoutをfail-closedで拒否し、失敗時にresponse bodyをcancelする。
- raw HTMLはinline実行せず、download時はattachment、`nosniff`、`no-store`、sandbox CSPを付与し、UI/search用plain textと分離する。
- external createの結果が不明な場合だけ`pending`を維持する。確定的な事前検証/設定失敗はsanitized `snapshot_storage_failed`で`failed`へ遷移する。reconcileは共有storageのread-only recovery/openだけを使い、put/write/createを再実行しない。
- downloadはshared adapterで事前検証済みのstreamへKnowledge固有のincremental size/hash guardを重ね、全量をheapへ保持せず、consumer終了時にprovider/local streamをdestroyする。
- Knowledge wrapperがopened metadataを早期拒否する場合もunderlying streamを即時destroyする。owner一致済みready rowのprovider key欠落、local file不在・open失敗はowner-scope不一致の404と混同せず、sanitized storage failureとして扱う。
- ACLはrequest-time authorizationに加えprovider I/O直前・直後に再評価する。HTTP body送信開始後のgrant失効をchunk単位DB照会で割り込ませる契約ではない。
- 共有`ArtifactStoragePort.store()`は既存Chat/PDF/Reportのidempotency/failure契約を維持しつつ、既存rowの全状態とunique-create/ready CAS競合でowner一致も照合する。追加した`recover()`だけが`pending` / `failed`の既存artifactをread-onlyで回復する。
- reconcileのshared recovery/open失敗はKnowledge port境界で`not_found|storage_failure`へ正規化し、provider error detailを上位callerへ渡さない。
- text/URL captureのJSON Schema/OpenAPIは`captureMethod`に応じて`text`または`url`を条件付き必須とし、反対側のpayload併記もservice呼出前に拒否する。multipartのsize超過は全経路で同じsanitized 413 code/messageを返す。
- fixtureはsynthetic identifierだけを使用し、production credential、folder ID、provider URL、個人情報は保存していない。

## Focused verification

| Command / check                           | Result | Evidence                                                                             |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| Knowledge snapshot/storage focused tests  | PASS   | final review remediation 132 testsを3回連続実行、fail/cancelled/skip/todo 0          |
| expanded security/transport focused tests | PASS   | env/schema/capture/storage/safe HTTP/legacy downloadを含む224 tests、全失敗区分0     |
| capture contract remediation              | PASS   | method別必須payload、反対payload拒否、multipart 413 messageをservice呼出前に固定     |
| storage failure remediation               | PASS   | ready row破損、local file不在分類、legacy API互換、stream destroyを回帰testで固定    |
| focused source coverage                   | PASS   | 対象9 source modules: statements/lines 92.59%、branches 76.42%、functions 96.97%     |
| PostgreSQL 15 integration                 | PASS   | 2 snapshots、2 artifacts、5 audits、version `[1,2]`                                  |
| ACL integration                           | PASS   | outsider detail/downloadはともに404、owner downloadは38 bytes                        |
| migration deploy/status                   | PASS   | ephemeral DBへ既存migrationを含めて適用し、snapshot capture/reconcile/downloadを実行 |
| backend lint / format / typecheck / build | PASS   | repository標準commandがexit 0                                                        |
| backend full test                         | PASS   | 1,811 tests、fail/cancelled/skipped/todo 0                                           |
| `git diff --check`                        | PASS   | whitespace error 0、integration shellの`bash -n`もPASS                               |

### Focused coverage summary

| Module group              | Statements / lines | Branches | Functions |
| ------------------------- | -----------------: | -------: | --------: |
| all focused modules       |             92.59% |   76.42% |    96.97% |
| knowledge adapters        |             96.57% |   85.09% |      100% |
| shared storage            |             93.79% |   74.75% |      100% |
| knowledge application     |             89.55% |   76.23% |    93.48% |
| knowledge snapshot routes |             96.67% |   79.73% |      100% |
| safe HTTP transport       |             88.49% |   67.61% |    95.45% |

### PostgreSQL integration summary

```json
{
  "result": "PASS",
  "snapshots": 2,
  "artifacts": 2,
  "audits": 5,
  "versions": [1, 2],
  "outsiderDetail": 404,
  "outsiderDownload": 404,
  "ownerDownloadBytes": 38
}
```

これはsynthetic fixtureの集計であり、production件数やidentifierを含まない。ephemeral PostgreSQL containerとscratch artifactは検証後に削除され、persistent volume/networkは作成していない。

## Failure/recovery and concurrency verification

- DB intentを外部storeより先にcommitし、外部I/O中にDB transactionを保持しないことをcall-order testで確認した。
- store後のDB finalization失敗では成功を返さず`pending`を維持し、次のreconcileが同じartifactをread-only recoveryしてreadyへ確定することを確認した。
- failed/pending idempotent replayは200を返さず、sanitized capture failure、`storage_pending`、またはstate conflictを返すことを確認した。
- concurrent finalizerが先に同一artifact/hash/type/sizeでreadyにしたCAS競合は、そのexact stateをowner scopeで再読して成功として収束し、重複auditを作らないことを確認した。
- captureのartifact store前にitem ownershipが失効した場合はartifactを作らずsnapshotをsanitized `failed`へ遷移して404を返す。store中に失効した場合はartifactを削除せずmaterialized snapshotを`pending`に維持して404を返し、item restore後のread-only reconciliationを可能にすることを確認した。
- reconcile/downloadの途中でitem ACLが失効した場合も404となり、download用staged streamを破棄することを確認した。
- 共有artifact storeのready/pending/failed idempotent再利用とunique/CAS競合はowner一致を必須とし、owner跨ぎkey collisionをprovider I/OまたはDB mutation前の`artifact_idempotency_conflict`で拒否することを確認した。
- reconcileのshared recovery/openがraw provider errorを返しても、Knowledge portからはsanitized `KnowledgeArtifactOpenError`だけが返り、detailが露出しないことを確認した。
- local/GDrive fakeのfailed rowと、result-unknown local pending rowを、二度目のupload/writeなしでrecoverできることを確認した。

## Independent review remediation

- correctness reviewで、確定的なlocal directory/configuration failureもresult-unknown扱いとなり、artifact不在のpendingが回復不能になり得る点を検出した。Knowledge artifact errorに`failed|unknown` outcomeを追加し、allowlistした事前失敗だけを`failed`へ遷移、generic/provider-side-effect不明は`pending`維持とした。failed replayも同じsanitized 502を返す。
- correctness reviewで、認可済みdownloadのprovider/corruption障害がowner-scope不一致と同じ404になる点を検出した。owner-scoped `artifact_not_found`だけ404とし、その他はdetailを出さない`snapshot_download_failed` 502へ分離した。
- correctness delta reviewで、owner-scoped open成功後のsnapshot/artifact metadata driftだけ404が残っている点を検出した。この分岐もsanitized 502へ統一し、stream破棄とstatus codeをtestした。
- security reviewで、Knowledge wrapperが最大10 MiBを全量heapへ再バッファしていた点を検出した。shared adapterの事前verify/stagingは維持しつつ、Knowledge wrapperをlazy incremental size/hash streamへ変更し、store/reconcileの再検証もbodyを保持せず消費する。consumer終了時はunderlying streamをdestroyする。
- security reviewで、text/plain/htmlの1 MiB上限が10 MiB読込後に評価される点を検出した。URLはContent-Type判定直後、multipartはfile metadata取得直後から1 MiBで停止・cancelするtestを追加した。
- response送信開始後のACL失効はrequest-time authorizationモデルの範囲外であり、chunk単位のDB照会はraceを完全に除去できず負荷も増やすため採用しない。provider I/O直前・直後のcurrent ACL再評価を明示的な境界とする。
- `capturedBy`は認可済みERP4利用者向けprovenanceで、provider metadata非公開とは別契約である。canonical account IDを維持し、証跡の過剰な非公開表現を修正した。
- CodeQLでHTML entityの二重復号と、test差替え可能な`fetch`分岐へのSSRF taintを検出した。entityは単一replace passで1回だけ復号し、`&amp;lt;`等を再解釈しないtestを追加した。outbound transportは差替え分岐を除去し、検証済みhostをDNS pinningするNode HTTP(S)経路へ一本化した。既存LLM/SendGrid testもloopbackの実HTTP transportへ変更し、test-only bypassを残していない。
- Copilot reviewで、共有storageのBuffer bodyが宣言size/hashと不一致でもprovider I/O後まで失敗しない回帰を検出した。新規writeまたはfailed retryのDB mutation/provider取得より前にlength/SHA-256を照合し、両不一致でDB row/provider call 0を確認した。ready/pending idempotent reuse/recoveryはbodyを再検証しない既存契約を維持し、stream bodyも既存のwrite後verification契約を維持する。
- correctness delta reviewで、response headers受信後はcaller abortとtotal timeoutがbody streamへ伝播しない点を検出した。internal signalをNode responseへ接続し、responseのend/close/errorまでlistener/timer cleanupを遅延した。headers後caller abortとstalled body timeoutが`AbortError`でbody readを失敗させることを実HTTP serverで確認した。Content-Length未達のpremature closeもbody読込成功として扱わない回帰testを追加した。
- 最終Copilot review本文のsuppressed findingsを再評価し、global 1 MiB body limitでは有効な上限textがJSON envelope分だけtransportで拒否され得る点と、多バイト文字のUTF-8 byte上限がroute境界まで確定しない点を修正した。route envelopeを最大6倍escapeと固定overheadでboundedに広げ、serviceより前に実UTF-8 byte数を413判定する。upload streamの非size I/O errorを413へ誤分類する従来分岐もsanitized 400へ分離し、worst-case JSON escapeの上限exact body、多バイト超過、multipart parser size error、非size stream failureをroute testで固定した。独立correctness reviewのLow test-gapへ対応後のactionable findingは0、独立security reviewはblocker/high/medium/low 0/0/0/0。
- exact-head Copilot review本文のsuppressed findingで、共有`safeFetch`が`Location`付き3xxだけを`redirect_blocked`へ正規化し、`Location`なし3xxをresponseとして返すfail-open差分を検出した。全3xxをresponse body送信前に破棄して同じsanitized errorへ正規化し、`Location`有無の両経路を実HTTP serverで固定した。Snapshot callerの既存non-2xx拒否に依存せず、共有transport境界単体でredirectをfail-closedにする。
- 独立correctness reviewで、長時間のmaterialize/store中にitemがlogical deleteされてもcaptureが`ready`へ確定し得る点を検出した。materialized metadata記録前とfinalization transaction内にcurrent owner/active item再検査を追加し、store前失効はartifactなしのsanitized `failed`、store中失効はsource-delete禁止を維持した`pending`として、どちらもpublic 404へ正規化した。
- 独立security reviewで、共有artifact adapterの既存ready row再利用がartifact metadataだけを照合しownerを照合しない点を検出した。store/recoveryの既存row、unique-create race、ready CAS raceの全再利用経路でowner一致を必須化し、owner不一致時に副作用なしでfail closedとなるtestを追加した。
- exact-head Copilot review本文のsuppressed findingで、Knowledge artifact `reconcile()`だけがshared recovery/openのraw errorをport境界で正規化しない点を検出した。reconcile全体を既存`openError()`へ統一し、provider detailを含むrecovery failureとowner-scoped open不在をそれぞれsanitized `storage_failure` / `not_found`へ固定するtestを追加した。
- 次のCopilot review本文のsuppressed findingsで、text/URLの条件付き必須payloadがOpenAPIへ表現されていない点と、multipart parserのsize超過だけ413 messageが不一致な点を検出した。top-levelのbounded property contractへmethod別`oneOf`を追加し、反対payloadも拒否するroute/OpenAPI testと、統一message assertionを追加した。
- 独立correctness/security reviewで、owner一致済みready local rowの実体file不在がowner-scope不一致と同じ`artifact_not_found`となる点と、不正opened metadataの早期拒否時にstreamを破棄しない点を検出した。DB/owner-scope不一致だけを`artifact_not_found`として維持し、ready rowのprovider key欠落は`artifact_provider_key_invalid`、local open失敗は`artifact_local_io_failed`へ分離した。実filesystemのmissing-file chainがKnowledge `storage_failure`となるtest、およびopen/reconcileのinvalid size/hashでsource streamが未読のままdestroyされるtestを追加した。新exact headの独立再レビューはpush後に実施する。
- 独立correctness delta reviewで、共有adapterの詳細化した内部errorが既存PDF/Evidence/Report downloadの従来404契約を500へ変え、Report deliveryが破損ready artifactを再試行し得る点を検出した。共有portのunavailable分類を既存3 routeだけで404へ互換変換し、`artifact_provider_key_invalid` / `artifact_local_io_failed`をReport deliveryの非再試行errorへ追加した。6 download分岐とretry policyを回帰testで固定し、Knowledge固有の認可後storage failure 502契約は維持する。
- 独立security delta reviewで、`recover()`が`ready`なのにprovider keyを持たない破損rowを`null`として返し、Knowledge reconcileがstorage failureを永続的pending 409へ誤分類する点を検出した。この状態を`artifact_provider_key_invalid`へ昇格し、port境界でdetailを消去して`snapshot_reconciliation_failed` 502となることをadapter/use-case testで固定した。

## Repository-wide quality gates

| Gate                                            | Result  | Notes                                                                                        |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| root lint / format / typecheck / build          | PASS    | backend/frontend双方                                                                         |
| frontend test                                   | PASS    | 82 files / 468 tests                                                                         |
| bounded-context coverage                        | PASS    | 280 source、233 targets、11 contexts、invalid/stale/unclassified/duplicate 0                 |
| `make ops-quality`                              | PASS    | Quadlet profile、S3 22 tests、storage readiness 2 testsを含む。live systemd/provider操作なし |
| backend/frontend audit                          | PASS    | high threshold、0 vulnerabilities                                                            |
| exact old-application compatibility             | PASS    | baseline `358cb9e4d134...`、旧application CRUD、migration 94→97、既存WS02 data保持           |
| OpenAPI export consistency / breaking diff      | PASS    | 再exportがbyte-identical、`breakingDifferencesFound=false`                                   |
| docs index / image links                        | PASS    | index 2 tests、115 links / 348 Markdown files                                                |
| repository secret scan                          | PASS    | intent-to-addを含む1,911 files、match 0                                                      |
| independent correctness/security review         | PENDING | 最新findingsは修正済み。新exact headのcorrectness/security再レビューをpush後に実施する       |
| exact-head GitHub Actions / CodeQL / Link Check | PENDING | push後に確認する                                                                             |
| exact-head Copilot review / unresolved threads  | PENDING | PR作成後に確認する                                                                           |

old-application compatibilityの後に変更したのはapplication-level ACL/concurrency処理とtestであり、Prisma schema/migrationは変更していない。このcompatibility確認はrepository-side rollback evidenceであり、production rollbackやrestoreの証跡ではない。

## Migration / rollback

- migrationはenum、snapshot table、constraint、index、foreign keyを追加するだけで、既存rowを更新・削除しない。
- application rollbackではsnapshot/artifact dataと新tableを保持したまま旧imageへ戻す。down migration、table drop、source artifact削除は行わない。
- Knowledge providerはcontext単位で`local`へ戻せる。既存Chat/PDF/Evidence/Report provider設定とshared storage row契約は維持する。
- provider切替前にlocal snapshot artifactを削除しない。実provider migration/cutoverは本PRの対象外とする。

## 未実施・非対象

- production/Sakura VPSへのmigration deploy、backup、isolated restore、systemd/Quadlet lifecycle
- Google Drive/Sakura Object Storageの実credentialを用いたupload/download/reconciliation
- Shared Drive/folderの実権限、quota、OAuth expiryを用いたtarget-environment試験
- provider cutover、source artifact削除、retention prune
- manual capture UI、frontend E2E、sanitized screenshot evidence
- authenticated page scraping、X/Threads公式API巡回

repository-side fake/local検証を実Google Drive、Sakura VPS、production成功として扱わない。PR Bを含むIssue #2012全体の完了までは、本Issueをcloseしない。
