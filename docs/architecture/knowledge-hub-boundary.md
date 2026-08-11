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

Issue #2015 の expand 段階では、既存 application rollback を維持するため
`ChatMessageType` に未知値を追加しない。share card の Chat root は引き続き
`messageType=text` とし、本文は内容を含まない固定 fallback
`Knowledge was shared.` だけを保存する。新 client は、Chat message と一対一の
`KnowledgeShare` relation を additive discriminator として扱い、選択済み内容は
typed immutable snapshot row だけから表示する。旧 client は relation を知らなくても
固定 fallback を通常 text として安全に表示できる。

- preview は source、destination room、選択 field、exact source version/hash、actor、
  10分の期限へ HMAC で束縛し、本文、生 ID 一覧、request key を token へ格納しない。
- commit は current source read と destination post ACL を再検査し、外部参加者を許可する
  room は初期実装で fail closed とする。preview 結果だけを認可根拠にしない。
- project roomでは既存Chat room policyのcanonical project claimをpreview/commit transaction内で
  再評価する。active `Project` rowも再照会し、commit時は対象rowをlockする。既存APIが要求しない
  `ProjectMember` rowを新たな認可条件にせず、削除済みprojectのroom aliasだけをfail closedにする。
- Knowledge の owner/sharer/audit には canonical `UserAccount.id`、Chat room ACL と
  `ChatMessage.userId` には同じ認証要求から server-side に解決した既存 Chat identity
  (`externalId` または `userName`) を使用する。両者を同一文字列と仮定せず、share row の
  immutable `chatPosterUserId` で generic root の投稿者を DB でも検証する。
- canonical URL は credential/query/fragment を除去するだけでなく、Google Drive/Docs と
  storage/provider host を共有対象外として fail closed にする。provider object identifier を
  path から card snapshot へ移送しない。host allow/deny 判定前に末尾ドットを拒否し、
  DNS absolute-name 表記で provider host 判定を迂回できないようにする。
- share は `pending → posted|failed|revoked` および `posted → revoked` だけを許可し、
  結果不明時は `pending` を維持する。reconciliation は既存 message/reference の照合だけを
  行い、新しい Chat message を作成しない。
- revoke 後も root/thread と immutable snapshot row は監査履歴として保持するが、card read は
  内容を返さず revoked placeholder だけを返す。source delete/ACL失効は自動 revoke ではない。
- revoke は sharer または source owner の明示操作だけを許可し、その他の actor には
  missing と同じ `not_found` を返す。Chat 投稿後の通知は固定 fallback だけを受け取る
  fail-open side effect とし、通知失敗で committed `posted` 状態を巻き戻さない。official room
  と viewer group を既存 Chat audience policy と同じ条件で解決し、share notification だけは
  message/recipient を domain-separated SHA-256 で束縛した nullable unique key により、並行実行と
  retryを一件へ収束させる。既存 notification producer はこの nullable key を使用しない。
- 同じ actor/request key/payload の replay は、署名済み token の actor/source/room/payload bindingを
  検証した後、現在の source/room ACL や token expiry より先に既存確定結果を返す。これは新しい
  mutation の許可ではなく、既に確定した結果の回収だけに限定する。新規 commit は従来どおり
  token expiry、current ACL、exact source versionを全て再検査する。
- `posted`/`revoked` share に紐付く generic Chat root は、本文、投稿者、room、thread topology、
  logical-delete状態の直接変更と物理削除をDB triggerで拒否する。通常のChat削除APIもこのrootを
  削除せず、表示停止はKnowledge share revoke endpointだけが担う。pending shareを既存rootへ
  reconcileする際はrootを`FOR UPDATE`でlockしてexact fallback/topology/deleted stateを再検査し、
  本文変更やlogical deleteとの競合後にposted+invalid rootが成立しないようにする。
- room-only viewer の card read は current Chat room ACL、元 item を開く導線は current room ACL と
  current Knowledge ACL を別々に再評価する。card responseに元 item/source rowの内部IDを含めない。
- 旧root timeline/thread responseはstrict OpenAPI clientとの互換のためshapeを変更しない。
  card-aware clientはtimelineで受信した1〜100件のexact message IDを
  `GET /chat-rooms/{roomId}/knowledge-share-messages?messageIds=...`へ渡し、`messageId`、`shareId`、
  `posted|revoked`、optimistic `version`、schema versionだけのcompact discriminatorを固定本数の
  batch queryで読む。timeline query、ACK、attachment、reply aggregateを再実行せず、並行投稿による
  page driftを避ける。通常messageはこの専用responseへ含めない。roomがexternal-enabledへ変化した
  場合はsummaryも404とし、share存在とstable share IDを公開しない。
- card本文は`GET /chat-messages/{messageId}/knowledge-share`から単体取得する。active rootと
  current room ACL、active project、share状態を同一`REPEATABLE READ`
  snapshotで検査する。missing、unauthorized、non-share、pending、failedは同じ404、revokedは
  content-free placeholderとし、postedだけがtyped immutable snapshotを返す。
- roomが投稿後に`allowExternalUsers=true`へ変わった場合、明示的なexternal audience契約がない
  MVPではcard本文をfail closedとする。固定Chat fallback、search、notification、unread、ACKから
  selected contentを再構成できる形にはしない。
- source-openはshareと未削除Chat rootのexact binding、current room ACL、active projectを同一
  snapshotで再検査する。cardの`canOpenSource`はこれらに加えてcurrent Knowledge ACLを再検査した
  結果である。source logical delete/ACL失効後もposted snapshotは表示するが、source identityとopen
  capabilityは返さない。保存済みcanonical URLもresponse時に再sanitizeする。

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

Knowledge Hubの外部AIは、Chat summary固有関数ではなく共有provider-neutral portへ依存する。共有adapterはprovider I/Oなしのprepareと単一使用dispatchを分け、prepareでserialization、URL/DNS/non-public-address検査、DNS pin、body変換を終える。pre-dispatch検証timeoutとprovider network timeoutは分離し、後者はdispatch開始時から計測する。Knowledge側は未対応surrogateを拒否してversion付きcanonical provider body bytesから生成したprepared fingerprintとimmutable provider request hashを照合し、runのdispatch intent／mandatory auditをcommitしてから同じprepared requestをdispatchする。selected contextはsourceごとに独立したprovider messageへserializeし、source本文内のdelimiter-like文字列が別sourceまたはuser promptの境界へ化けないようにする。contextを持たないChat requestは従来どおりsystem/user二messageのpayloadを維持する。prepare後のcaller object変更でbody、model、policyは変化しない。これにより確定的pre-dispatch failureだけをreleaseし、intent確定後のtimeout/socket failureをunknown/held maximumとして扱える。adapterはtransport安全性だけを所有し、Knowledge側がselected context、exact source version、preview/confirm、ACL、budget reservation、idempotency、監査を所有する。4xx/5xxのprovider本文はpromptやsecretを反射し得るため監査可能なerrorへ連結せず破棄し、HTTP statusと固定failure codeだけを正規化する。成功header後のbody timeoutは結果不明、DNS／scheme／host／non-public-address guard failureはtypedな未dispatchとして区別し、空の成功本文をKnowledgeの通常成功にしない。`allowPrivateIp=false`はIANA IPv4/IPv6 Special-Purpose Address Registry（実装基準日2025-10-09）の非グローバル範囲とmapped/link-local/unique-local/multicast等をliteral/DNS双方で拒否し、registry更新時にCIDR一覧とnegative fixtureを同時更新する。private IPを明示許可する非production構成でもDNSを接続前に解決・pinし、Node lookupのfamily/all契約と解決失敗のcertaintyを維持する。providerの成功本文とusageは別々に正規化し、有効な本文にusage欠落または不正usageが付随する場合は本文を失わず明示的な`missing|invalid`状態を返す。Knowledge側はこれを通常成功にせずmaximum reservationを保持する。provider固有の非課金保証がない4xxもreleaseせずmaximumを保持する。Chatの既存prompt、`CHAT_EXTERNAL_LLM_*`、user/room rateと空応答fallbackは独立した互換wrapperに残す。

予算正本はPostgreSQLのversioned policy、月次period、run、request ledger、reservationである。personalはuser policy、organizationはuser/org policyを同一currencyで決定順lockし、hard limitを`settled + active + held + new maximum`で評価する。active policyの選択とrow lockは同一statementで行い、同時version切替はSerializable bounded retryでactive versionを再解決する。現在windowと重なるinactive versionのperiodが異なるcurrency/timezoneを持つ場合は、旧月境界を現在policyで再解釈せずfail closedとする。reservation INSERT triggerが初期run、subject、period、currency、amount、timestampを検証してperiod counterを同じtransactionで更新し、dispatch後の追加予約と同一subject二重予約を防ぐ。policyのIANA timezoneとrequest非依存のserver clockから月次UTC境界およびrolling rate時刻を算出し、process timezoneやclient timestampを使用しない。reservation/dispatch/settlement/reconcileも同じtrusted clock境界を使用する。execution stateとsettlement stateを分離し、provider結果またはusageが不明なら通常successにせずmaximum reservationを保持する。

provider call中はDB transactionを開かない。dispatch前にrun/reservation/audit、catalog単価snapshot、ordered selected-context rowを同一transactionで確定し、provider/model/version/単価/currency/maximum costは有効catalogからuse caseが解決してbudget port入力を再構築する。最大reservationのinput estimateとprovider request hashは、system prompt、独立上限を適用したraw user prompt、typed source identity/version/hashとexact representationを一体化したordered context、source framing、固定provider message framingからuse case内で導出し、callerはfingerprintや値を独立指定して減らせない。PR Aのbudget foundationはcaller supplied preview hashを確認済みの根拠として受け取らず、実prompt/context/model/scopeからrequest ledger hashを再計算する。後続PR Bのpreview verifierは同じcanonical provider request hashへ署名tokenを束縛し、照合後にだけreserveへ進む。soft-limit warningはrunへ固定してidempotent reuseでも保持する。provider callは自動retry・fallbackなしで一回だけ行う。normalized outcomeは本文をcaptureした未finalized rowとして保存し、DBがdomain-separated SHA-256を再計算してcontent hashを検証した後にだけ本文消去を伴うfinalizeを許可する。outcome finalizeとsettlement/reconcileはoutcome→run→reservation→periodの決定順lockを共有する。settlementはassistant/AI turnへのhash束縛、snapshot単価とusageからのactual cost再計算、typed完了／失敗／結果不明／usage不明auditを同じtransactionで確定する。dispatch timestampは最初の`reserved -> dispatched`でだけ設定でき、それ以降の中間・terminal状態で変更できない。reservation rowの削除はtriggerで拒否し、period counterとrolling rate accountingを保持する。`result_ready + held_maximum`はfinalized `usage_unknown` outcomeとassistant/AI turnが一致する場合だけ許可し、finalized outcomeの直接INSERTはDBで拒否する。後日usageが確認できた場合はprovider outcomeを改変せず、immutable operator billing evidenceを追加し、run ownerとは別にauthenticated operatorのcanonical user IDをevidence createdByとmandatory auditへ保存する。DB/applicationの両境界でself-settlementを拒否し、operator interventionは専用actorRole/reasonCode/allowlisted分類で識別する。snapshot単価でactual costを再計算し、同じtransactionでheldからactualへ一方向精算する。同一evidenceの再照合は同じoperatorだけidempotent、異なるoperator/evidenceはconflict、evidence更新・削除は禁止とする。timeout、connection outcome unknown、finalization failureは`failed`ではなくreconcile可能な`result_unknown + held_maximum`へ限定する。`result_unknown + held_maximum`の全許可failure codeは、同一runのvalid/finalized outcomeを後から安全に取得できた場合だけreconcile可能とする。安全なprovider outcome lookupがない場合は再dispatchせず、unknown/held maximumを維持する。

LLM固有auditはtop-level `AuditLog.userId`だけをcanonical actor正本とし、caller supplied principal／delegated actor／scope IDをmetadataへ複製しない。metadataはprovider/model、件数、token/cost、結果code、request correlationと`api|agent`区分だけのallowlistとする。

selected contextはtyped FKとexact version/hashを持つimmutable rowで表現し、自由な`sourceType + sourceId`を正本にしない。dispatch時にDBはFK先のversion/hash、domain-separated representation hash、`UTF-8 bytes * 2 + 16 framing tokens`、種別別・合計・関連item・provenance depth上限を再検証し、source IDを含むorder-sensitive opaque fingerprintへ束縛する。runのconversation referenceはresult_ready遷移時だけ設定でき、reserved/dispatched/failed/result_unknownではnullを維持する。assistant resultは同じownerの`KnowledgeConversation`と、そのconversationに属するassistant turnの複合FKへ結び付ける。provider outcomeは最大256 KiBのnormalized contentだけをfinalizationまで一時保持でき、finalize時に本文をconversation turnへ移してoutcome rowから消去する。

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
- promote はChat messageを`KnowledgeConversation`へ変換せず、独立した
  `KnowledgeThreadPromotion` aggregateとimmutable selected-message child rowで表現する。これにより
  manual/JSON/Markdown conversation importのowner/effective ACLと、Chat room ACLを混同しない。
- preview/commitはKnowledge share root、share version/content hash、ordered direct reply集合と各content
  hash/activity boundary、destination scope/group grants、利用者が入力したsynthesis version 1本文を束縛する。
  commitはcurrent Chat room readとcurrent Knowledge destination writeを別々に再検査し、どちらかが失効した
  場合はfail closedとする。
- synthesis provenanceは`KnowledgeSynthesisSource.sourceThreadPromotionId`のnullable FKを既存
  exactly-one制約へ追加して固定する。promotion後にroom accessまたはshare状態が失効した場合、immutable
  synthesis本文はdestination ACLで保持する一方、promotion source IDとlive Chat identityはredactする。
- promotion request ledgerはraw keyを保存せずcanonical ownerとdomain-separated hashで一意化する。
  selected snapshot、synthesis/version/source、明示organization grants、mandatory auditは同じSerializable
  transactionで確定し、同時replayを最大3 attemptで一件へ収束させる。
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
request keyはhash前にC0/C1、Unicode `Bidi_Control`、BOM、ill-formed UTF-16 surrogate、端部whitespaceを
拒否し、視覚的に紛らわしい別operation keyによるidempotency誤認を防ぐ。
同じpayloadのreplayは同じconversationへ収束し、post-importに手動turn/itemが追加されてもreplayで
import turnを再追加しない。conversationがlogical delete済みの場合は再利用せずsanitized conflictとする。
ledgerはconversationとのowner複合FKでcross-owner bindingを拒否し、immutable triggerで履歴を保持する。
provider/modelのDB公開語彙CHECKはimport識別子があるconversationだけへ適用する。`NOT VALID`で
migration前rowのscanを避けるだけでは無関係なUPDATE時の再検査を防げないため、非importの旧rowは
未対応値を保持・responseでredactしたままturn/item変更に伴う親row更新を継続できる条件にする。

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
- budget policyを月中にversion更新しても同じsubjectの当月reservationを引き継ぎ、active versionの上限で再評価する。rolling rateもpolicy IDではなくsubject単位で集計し、policy差替えによる上限リセットを許可しない。
- timeout 等で provider 実行結果または usage が不明な場合、最大 reservation を消費扱いで保留し、自動再送しない。operator reconciliation または請求 usage 確定後だけ精算する。
- selected contextはrunのdispatch時に連続ordinalの集合として凍結し、以後のsource追加をDB triggerで拒否する。provider outcomeはdispatchより前のcaptureを拒否し、settlement時はnormalized outcomeとassistant turn本文のdomain-separated hashを再計算して照合する。

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
