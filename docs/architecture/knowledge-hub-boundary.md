# Knowledge Hub 境界 ADR

- Status: Accepted when the PR closing Issue #2007 is merged
- Decision date: 2026-08-03
- Initial code audit baseline: `origin/main` `96043b518e243238138881b03e1c827d4a4395d4`
- Final synchronization/review baseline: `origin/main` `7ef3bc16592499b69fa5ded2b91f8c0939b427b9`
- Related: #2003, #2007, #1875, #1975, #1981, #1982, #1983, #544

## Context

Knowledge Hub は、外部情報、利用者メモ、AI 対話、社内議論を出所別に保持し、必要な部分だけを既存チャットへ共有する。個人領域を扱うため、通常の CRUD よりも list、件数、検索候補、ログ、外部 AI 入力、export といった間接経路の非漏えいが重要になる。

現行 ERP4 には room chat、ERP/チャット検索、外部 LLM 要約、監査、redaction、context 別 artifact storage がある。一方、Knowledge Hub 専用の schema、route、UI、ACL、ADR はない。既存基盤を再利用しつつ、Chat、Storage、Knowledge の依存方向を固定しなければ、personal データの漏えい、Drive 実装の重複、既存チャット ACL の回帰が生じる。

本 ADR は境界と失敗契約を決める。正確な Prisma model 名、API path、index 定義は後続 Issue で決める。

## Decision

### 1. システム境界

- Knowledge Hub は ERP4 modular monolith 内の bounded context とする。別 VPS、別認証、別 DB、別 queue、別検索クラスタを MVP の必須要件にしない。
- PostgreSQL を metadata、text、relation、検索 index の正本とする。GitHub、Markdown、外部 LLM、Google Drive は正本にしない。
- binary snapshot は既存 `ArtifactStoragePort` / `StorageArtifact` / object-store infrastructure を拡張して利用する。Knowledge 専用 Google Drive client を作らない。
- Knowledge application 層は Chat/Storage の Prisma model や provider client を直接呼ばず、context 内 repository port と明示的な integration port を呼ぶ。
- Chat application 層も Knowledge table を直接更新しない。share と promote は application boundary で連携し、片側の失敗を暗黙に成功扱いしない。
- route/preHandler は authentication と coarse role guard を担当し、application/use case は business ACL と query predicate を一貫して担当する。frontend の表示制御を認可の代用にせず、取得後 filter へ逃がさない。

想定する依存方向は次のとおりとする。

```text
HTTP route / UI
      │
      ▼
Knowledge application use case
      ├── Knowledge repository port ──► Prisma adapter
      ├── Knowledge artifact port ────► shared ArtifactStoragePort adapter
      ├── Chat share port ────────────► Chat application adapter
      └── External AI port ───────────► provider adapter (default disabled)

Google Drive / local storage infrastructure
      └── Knowledge・Chat の業務 context へ依存しない
```

### 2. 正本と provenance

- `KnowledgeItem` は一件の論理的な情報項目、`KnowledgeSnapshot` は保存時点の immutable version とする。
- snapshot の本文、metadata、binary artifact reference、SHA-256、capturedAt、capture method を同じ version の provenance として追跡する。
- 元 URL の変更検知時は既存 snapshot を更新せず新 version を追加する。
- annotation、conversation turn、synthesis、share snapshot は元 snapshot 本文へ連結せず、作成者、作成日時、source type、参照関係を別に保持する。
- logical delete は visibility を失効させるが、監査と既存 share snapshot を書き換えない。MVP は自動物理削除を行わない。
- export は正本の copy であり、export 後の Markdown/JSON 編集を ERP4 へ自動反映しない。

### 3. personal / organization / chat share

#### personal

- 通常 API/UI で read/write できるのは owner 本人だけとする。`admin`、`mgmt` であることだけを理由に通常 read を許可しない。
- owner ID をすべての query の後処理ではなく DB predicate に含める。取得後 filter に依存しない。
- personal label、annotation、AI conversation、saved view は明示選択なしに organization または Chat へ複製しない。
- 会社システム上のデータであり、承認済み break-glass、監査、backup の対象外ではないことを UI/運用文書に明記する。

#### organization

- organization scope は「全 role に公開」を意味しない。後続 schema で明示的な組織 ACL/grant を持たせ、既存 user/group/project context と整合する server-side policy で判定する。
- grant を解決できない、actor context が欠ける、relation が壊れている場合は deny する。
- personal から organization への移行は preview、共有 field 選択、確認、監査 event を一つの use case として実施する。scope field の単純 PATCH にはしない。

#### chat share snapshot

- Chat には元 item の live view ではなく、共有時に利用者が選択した field だけを immutable share snapshot として渡す。
- Chat の閲覧者は Chat room ACL と share snapshot の状態で閲覧する。元 personal item への権限を取得しない。
- title、source、canonical URL、excerpt、選択 label、共有者メモ、AI 要約、synthesis は個別 opt-in とし、personal label、非共有 annotation、AI 対話全文は既定で除外する。
- share snapshot から storage provider key、Drive URL、内部 folder/Shared Drive ID を返さない。
- 元 item を logical delete しても、監査上必要な既存 share snapshot は自動削除・自動更新しない。表示停止が必要な場合は別の revoke event とする。

### 4. すべての read surface での認可

同じ authorization policy を少なくとも以下から呼び、件数や候補から personal item の存在を推測できないようにする。

- list、detail、count、pagination total
- full-text search、label filter、ANY/ALL/NOT、saved view
- autocomplete、suggestion、related item、重複候補
- AI prompt 構築、要約、embedding 等の後続処理
- share preview、share card、thread promotion
- export、import reconciliation
- snapshot/attachment download
- audit UI、application log、error response
- delete、restore、break-glass

権限外の ID について、存在を示す必要がない endpoint は `not_found` 相当として扱い、件数、label 名、hash、更新日時を返さない。監査側には actor、action、target type、結果、reason code を残すが、本文、URL query、token、provider identifier は残さない。

### 5. break-glass

- Knowledge 用 break-glass の必須条件は、二重承認、申請理由、対象/viewer/TTL 固定、read-only、実アクセス log、owner への可視化、職務分離とする。Chat 文書の「案」を規範として参照せず、本 ADR の条件を Knowledge の正本とする。Chat の request row も流用しない。
- 通常の `admin` 権限だけでは personal 内容を閲覧できない。申請者、承認者、閲覧者の職務分離を要求する。
- break-glass grant は対象 item/snapshot、期間、閲覧者、TTL を固定する。検索全体、export、AI 送信の権限へ自動昇格しない。
- grant と owner 向け非機密 notification/audit row を同じ DB transaction で確定し、通知記録なしに grant しない。reason text は owner 向け通知や一般 UI/log へ出さない。
- break-glass での binary download を含め、実アクセスごとに fail-closed で記録する。監査 row を確定できない場合は内容を返さない。

### 6. storage と download

- metadata transaction と外部 object write の間に分散 transaction はない。後続 Issue は `StorageArtifact` の `pending → ready|failed` と idempotency/reconciliation 契約を再利用する。
- 現行 `ArtifactStoragePort.open()` の owner scope は optional であり、既存 idempotency 一意性も owner を含めない。Knowledge context はこれを直接公開せず、`ownerType` / `ownerId` を必須引数にする `KnowledgeArtifactPort` 相当の wrapper を設ける。store/reconciliation の idempotency namespace に owner scope を含め、異なる owner 間で artifact を再利用しない。
- provider upload 後に Knowledge DB 更新が失敗した場合、結果不明の create を再試行しない。read-only reconciliation で hash、size、owner scope を照合してから回復する。
- download は ERP4 の認可済み endpoint だけから提供する。provider URL、provider key、直接共有権限を API に返さない。
- snapshot の metadata と binary artifact の owner type/owner ID を両方確認する。片方だけの一致で許可しない。
- source file の削除、Drive 完全削除、retention prune、provider cutover は通常 use case に含めない。

### 7. URL capture、active content、redaction

- MVP は利用者が URL、text、PDF、image、manual note を明示登録する。ログイン済み page の server-side 巡回や SNS の大量収集をしない。
- server-side fetch を後続で実装する場合、既存 `safeFetch` は scheme、DNS/private address、redirect、timeout の境界として再利用する。現行 helper は response の最大 byte と content type を強制しないため、Knowledge capture port/caller が bounded stream read、Content-Length と実読込 byte、許可 content type を別途 fail closed で検証する。
- HTML/Markdown は原文保存と表示用 sanitized representation を分ける。script、event handler、active embed を実行しない。
- canonical URL は credential、fragment、既知の tracking parameter を保存/表示前に正規化する。secret 様 query value は audit/application log へ出さない。
- fixture、snapshot test、test-results に実投稿本文、個人情報、実 account identifier を使わない。

### 8. 検索

- 初期検索は PostgreSQL の通常 index、全文検索、必要と判断された場合の `pg_trgm` を使用する。
- label は多対多 relation を正本とし、JSON 配列を正本にしない。
- authorization predicate を検索 query 内に適用する。検索後 filter で total や facet count が漏れる設計を禁止する。
- vector DB、Elasticsearch/OpenSearch、専用検索 SaaS は計測なしに導入しない。意味検索は search quality/latency の不足を証跡化した別 ADR で判断する。

### 9. external AI

- provider は既定 `disabled` とし、組織設定、利用者の明示操作、送信 preview、確認、監査、rate/cost limit がすべて成立した場合だけ呼ぶ。
- item/snapshot/annotation/attachment 全文を既定送信しない。利用者が選択した最小範囲を prompt material として固定する。
- provider、model、actor、日時、参照 item/snapshot、送信範囲の digest/分類、token usage、推定費用、結果 status を保存する。API key、prompt 本文、provider 生 error は通常 log に残さない。
- hard limit が未設定または残額不足の場合は送信前に拒否する。自動で別 provider や安価な model へ fallback しない。
- chatgpt.com の cookie/session を取得せず、初期会話取り込みは利用者が提供する Markdown/JSON/copy-and-paste に限定する。

### 10. transaction と failure semantics

- item create/update、snapshot append、label attach、share、export、delete/restore は idempotency key または明示的な version/optimistic lock を持つ。
- 現行 `logAudit()` は失敗を記録して呼び出し元を継続する fail-open helper である。Knowledge の必須監査 write ではこれをそのまま使用せず、同じ Prisma transaction を受け取って失敗を返す `KnowledgeAuditWriter` 相当の port を設け、業務 row と `AuditLog` を同じ transaction で確定する。既存 module の `logAudit()` 契約は本 workstream で変更しない。
- 外部 storage/AI/Chat 副作用を伴う操作は、副作用前の DB transaction で intent/status と監査 event を確定する。副作用後の finalization/audit が失敗した場合は success を返さず `pending|failed` と reconciliation 対象を残す。DB transaction を開いたまま外部 I/O を待たない。
- break-glass access、export、外部 AI 送信、認可済み binary download のように実アクセス監査が必須の操作は、監査 write 失敗時に操作を開始しないか応答を成功させない。通常 read を監査対象に追加する場合は、fail-open/fail-closed と可用性影響を対象 Issue で明示する。
- Chat share は share snapshot の DB 確定後に Chat application port を呼ぶ。Chat 側失敗時は share を `pending|failed` とし、元 item を organization 化したり成功表示したりしない。
- thread から synthesis への promote は対象 thread snapshot と選択 message を固定し、元 message の live body を synthesis へ暗黙連結しない。
- retry は read、stat、idempotent reconciliation 等に限定する。結果不明の外部 create、AI request、Chat post を新規操作として自動再実行しない。

#### annotation / conversation / synthesis provenance foundation

Issue #2013 PR Aでは、本文を相互に連結せず、`KnowledgeAnnotation` と immutable
revision、`KnowledgeConversation` と append-only turn/item relation、
`KnowledgeSynthesis` と immutable version/source relationを別集約として保持する。
annotation kind、origin、conversation role、item/source relation typeはDB enumとAPI
allowlistの両方で固定する。任意のpolymorphic `sourceType + sourceId`を正本にせず、
synthesis sourceは参照先ごとのnullable FKとPostgreSQLのexactly-one CHECKで一件だけを
指す。参照先の物理削除やcascade deleteは行わない。

- annotation mutationはcanonical actor本人だけが行い、編集時は旧revisionを保持して
  `currentRevision`を楽観的に進める。削除はlogical deleteとしrevisionを消さない。
- conversation mutationはowner本人だけが行う。linked itemは全件同一ownerでなければ
  relationを作成しない。relation内部の`ownerUserId`からconversationとitemの
  `(id, ownerUserId)`へ張る2本のdeferrable composite FKにより、直接insert、親owner更新、
  並行競合を含む同一owner制約をapplicationとDBの二層で保証する。
  conversation readはlinked item ACLのunionではなく共通部分で
  判定し、actorが一件でも現在readできなければtitle、turn、relation、件数を返さない。
  linked itemがないconversationはownerだけがreadできる。
- organization itemのnon-owner ACLはrequest開始時のgroup IDだけを信頼せず、item/grantを読む
  同じDB snapshot内でactorのcurrent `UserGroup` membership、active/non-deleted `UserAccount`、
  current organization、active `GroupAccount`を再検査する。membership失効がsnapshot開始前に
  commitしていればannotation、conversation、synthesis/source mutationをfail closedにする。
- turnは`conversationId + sequence`で一意とし、conversation versionを用いた競合検知を
  行う。roleとoriginの組合せもallowlistで検証し、既存turnを更新しない。annotation
  revision、conversation turn、synthesis version/sourceは新規table上のDB triggerでも
  update/deleteを拒否し、application経路外の履歴改変も防ぐ。
- PR Aのmanual APIはprovider/model/tool nameを入力として受け付けず、responseでもこれらを
  `null`へ固定する。PR Bでimport parserと同時に固定公開語彙を定義するまで、自由文字列を
  provenance labelとして保存・共有しない。
- personal synthesisはownerだけがread/writeできる。organization synthesisは同一
  organizationに限定したうえで、non-owner read時にcurrent versionの全sourceを現在
  readできることを再検査する。ownerが後からsource accessを失ってもsynthesis本文と
  version履歴は保持するが、非公開sourceはkind/relation/order/accessibilityだけを返し、
  source ID、provenance row ID、actor、timestamp、本文を返さない。
- synthesis versionは集約内versionを一意とし、version追加とsource固定を同一transaction
  で行う。synthesisをsourceにできるのは別synthesisの既に確定した固定versionだけとし、
  同一synthesis集約の現行・過去version参照をapplication検査とDB constraint triggerで拒否する。
  再帰的なcurrent access評価はfail closedかつ16段で停止する。認可結果memoは到達depthをkeyに
  含め、source順序によるdepth制限迂回を許さない。評価はrequest単位でmemoizeし、version node
  128、source edge 512、DB query 512を上限とする。source 0件のorganization synthesisは
  non-ownerへfail closedとする。
  create/append request内のowner確認、source検証、mutation後response組立ても同じaccess
  contextを共有し、repository呼出しごとにbudgetやmemoを再生成しない。
- list cursorは既存`KNOWLEDGE_CURSOR_SIGNING_SECRET`を使うHMAC署名付きopaque tokenと
  し、actor、resource、parent、sortへ束縛する。権限外rowをpage/cursor/countへ含めない。
  append-only履歴のcursor sequenceはPostgreSQL `INTEGER`最大値まで表現し、mutationの
  `expectedVersion`上限はincrement余地を残すため一つ小さい値とする。
  organization synthesis listのACL candidate走査は一request 200件までとし、query budget
  またはcandidate budget到達時は、非公開候補数をHTTP statusへ反映せず、空pageまたは既に
  確認済みのvisible rowだけを返してnext cursorを発行しない。ID指定readのquery budget超過は
  不存在/権限外と同じ`not_found`にする。version historyはlookahead rowもACL検査してから
  next cursorを発行する。
- mutation、mandatory Knowledge audit、version/idempotency確定は同じPrisma transaction
  で実行する。annotation/conversationの全readと複数source ACLのread/mutationは同一
  Repeatable Read snapshotで評価し、
  grant swapを跨いだ時点混在を許さない。監査action/targetとmetadata keyはallowlistで検証し、annotation、turn、
  synthesis本文、prompt、URL、provider key、raw error/request keyを監査metadataへ入れない。
  認証scopeはJWT/configと監査adapterで共有するbounded ASCII validatorを通し、URI path形式を
  維持しつつUnicode制御・bidi文字、userinfo、query、fragmentを認証前にfail closedとする。
  JWT文字列はU+0020 SPだけで分割し、comma-separatedの設定値はauth pluginのcall siteで
  配列化してからvalidatorへ渡すため、JWT scopeのTAB/LF等またはopaque comma tokenを権限scopeへ
  再解釈しない。
  array/config scopeと監査識別子はraw値の制御・format・bidi文字、ill-formed UTF-16 surrogateを
  正規化前にfail closedとし、JWT principal/actor/token/audience/issuerおよびBFF OIDCのprovider
  subject/issuerもcanonical identity lookup前に同じ検査を行う。`act.sub`の正確な空文字だけは
  既存の非委任fallback契約を維持する。
  malformed provenanceを有効なscope／別identity／actor attributionへ変換しない。
  JWT `exp`は存在する場合に非負safe integerへ正規化できる有限numberだけを受理し、認証と
  mandatory auditの型境界を一致させる。不正な署名済みclaimをbusiness mutationへ進めない。
  request IDはFastify logger binding前かつtrim等の正規化前にraw値をsafe allowlistで検査し、不正な外部値をrandom UUIDへ置換する。
  response、logger、mandatory auditへraw request IDを伝播させない。
  DB CHECKもannotation/conversation/synthesis/importのaction groupを対応するtarget tableへ
  厳密に束縛し、対象actionのnullableなtarget table/IDも拒否する。annotationの履歴・改訂・
  削除はparent itemが非削除であることを再検査する。
- annotation revisionとconversation turnの本文queryは、parent annotation/conversationの
  visibility確認と同じRepeatable Read transactionで実行し、子table query自身にもcurrent
  item ACL predicateを含める。このsnapshotをreadの認可線形化点とし、snapshot後にgrantが
  失効してownerが履歴を追加しても、そのrequestへ失効後の新規本文を混在させない。失効が
  snapshotより先にcommitした場合はfail closedとする。linked item ACLの共通部分も同じ
  snapshot内のturn queryで再評価する。

PR Aのmigrationはenum/table/index/FK/CHECKと新規履歴table専用DB triggerの追加だけを
行うexpand-only migrationであり、
既存table/columnのdrop、rename、型変更、既存row更新を行わない。application rollbackでは
新tableと履歴を保持したまま旧imageへ戻す。manual/JSON/Markdown importはPR B、UI/E2Eは
PR Cで実装する。

#### bounded conversation import boundary

Issue #2013 PR Bはimport transport、parser、preview token、idempotency ledgerをKnowledge
application context内に置き、routeからPrismaを直接呼ばない。parserはmutationを行わず、manual、
JSON、Markdownを一度だけ共通canonical modelへ変換する。全形式をcanonical unpadded base64urlと
fatal UTF-8で受け、JSONはparse前の有限scanner、Markdownはversion付きrole-block文法で処理する。
URL fetch、HTML実行、外部provider呼出しはこの境界に存在しない。

preview tokenは署名済みauthorization grantではなく、同じactor、format、payload、linked item集合を
10分間だけcommitへ束縛するtamper-evident operation tokenである。tokenへ本文やraw hashを格納せず、
actor/payload/itemは用途別HMAC bindingで表現する。commitではtokenだけを信頼せず、linked itemを
決定順にlockしてcurrent owner/non-deleted ACLを全件再検査する。

永続idempotencyはtoken secret rotationから分離し、ownerとopaque request keyのdomain-separated
SHA-256を`KnowledgeConversationImportRequest`へ保存する。raw request keyとpayloadはledgerへ複製しない。
同じpayloadのreplayは同じconversationへ収束し、post-importに手動turn/itemが追加されてもreplayで
import turnを再追加しない。conversationがlogical delete済みの場合は再利用せずsanitized conflictとする。
ledgerはconversationとのowner複合FKでcross-owner bindingを拒否し、immutable triggerで履歴を保持する。

import transactionはSerializable、最大3 attemptとし、各attemptでACL lock、request ledger、payload
idempotencyを先頭から再評価する。IDとserver commit timestampはretry外で一度だけ決定する。
conversation/turn/relation/ledgerと`knowledge_conversation_imported`、`knowledge_import_committed`等の
mandatory auditを同じtransaction clientで確定し、audit failure時は全mutationをrollbackする。

### 11. migration と rollback

- schema は expand → migrate → contract を原則とし、最初の migration は既存 Chat/API を変更しない additive migration とする。
- migration 中も旧 application が動作可能であることを確認する。既存 `ChatMessage` への thread/card field は Chat thread Issue で独立して expand する。
- application rollback は新 table/nullable field を残して旧 image へ戻す。production table/column の即時 drop や migration file の巻き戻しを rollback 手順にしない。
- data backfill/import は dry-run、manifest、checksum、idempotency、件数照合を持つ。contract migration は利用状況と backup/restore evidence を確認した別 Issue とする。

### 12. retention、backup、費用責任

- MVP は logical delete のみを自動化し、Knowledge データを自動物理削除しない。物理削除と保存年限は会社の retention 承認を得た別 Issue とする。
- DB backup は既存 ERP4 backup、binary は既存 object-store/backup 境界を使う。fake/local test を target-environment restore 成功と扱わない。
- 既存 ERP4/Google Workspace を除く月額増分目標は 5,000 円とする。追加 infrastructure は管理者が計測値と見積を提示し、業務責任者の承認を得た別 ADR/Issue で導入する。
- AI の hard/soft limit は `admin` が設定し、`mgmt` は利用量と予算状態を参照できる。hard limit がない状態で external AI を有効化できない。
- hard limit 判定は request ごとの最大 token/cost reservation を先に確保し、完了時に実使用量へ精算する設計とする。予約不能なら副作用前に拒否する。
- timeout 等で provider 実行結果または usage が不明な場合、最大 reservation を消費扱いで保留し、自動再送しない。operator reconciliation または請求 usage 確定後だけ精算する。

## Alternatives rejected

| 案                                             | 採用しない理由                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Knowledge 専用 SaaS/別 VPS                     | 認証、監査、backup、運用を二重化し、MVP の費用上限を不必要に消費する           |
| Google Drive/Markdown を metadata 正本にする   | transaction、ACL query、検索、version relation、監査整合を保証しにくい         |
| personal item の live view を Chat に表示する  | Chat 閲覧者へ後から非共有 field が漏れる。共有時点の immutable snapshot が必要 |
| Chat model 内に Knowledge 全 entity を追加する | bounded context が崩れ、既存未読/通知/検索/ACL の回帰範囲が拡大する            |
| 最初から vector DB/検索クラスタを導入する      | 通常検索の不足が未計測で、費用・backup・ACL index の責任が増える               |
| 外部 LLM へ snapshot 全文を既定送信する        | data minimization、明示同意、費用上限、監査要件を満たさない                    |

## Consequences

- 後続実装は一つの巨大 PR ではなく、schema、search、storage、conversation、Chat thread/share、AI、import/export、operations に分割する必要がある。
- ACL policy と query predicate の共通化に初期コストがかかるが、間接漏えいを test matrix で検証できる。
- immutable snapshot/share により storage 使用量は増える。容量上限、失敗、quota、retention を観測する必要がある。
- Chat/Storage integration は eventual failure state と reconciliation を持つ。単純な単一 transaction として扱えない。
- 実 Google Drive、実 external LLM、target-environment restore/cutover は本 ADR の repo-side 成功条件ではない。

## Verification required by downstream issues

- owner 外 personal item が list/detail/count/search/suggestion/export/download/AI/share から見えない negative tests
- share snapshot が選択 field 以外を含まない contract tests
- audit failure、storage partial failure、Chat post failure、AI timeout/usage不明/cost-limit の failure semantics tests
- Knowledge artifact の owner scope 省略不能、owner 跨ぎ idempotency collision、bounded read/content type の negative tests
- migration forward/old-app compatibility/application rollback tests
- fake provider と実環境 evidence の明確な分離
