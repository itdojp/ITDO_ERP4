# Knowledge Hub 基盤要件と現行 main 監査

- Parent Epic: #2003
- Workstream: #2007 (01: current-main audit / boundary ADR)
- Initial code audit baseline: `origin/main` `96043b518e243238138881b03e1c827d4a4395d4`
- Final synchronization/review baseline: `origin/main` `7ef3bc16592499b69fa5ded2b91f8c0939b427b9`
- Audit date: 2026-08-03
- Architecture decision: [Knowledge Hub 境界 ADR](../architecture/knowledge-hub-boundary.md)

## 1. 本文書の範囲

本書は Knowledge Hub 実装前の現状、データ分類、ACL/監査、費用上限、後続 workstream の受け入れ条件を定義する。Knowledge schema、migration、runtime API、UI は本変更に含めない。

Issue #2003 の固定決定を正本とし、本書は repository 内で実装者と reviewer が検証できる粒度へ展開する。

## 2. 現行 main 監査

### 2.1 実装済み基盤

| 領域                   | 現行実装                                                                                                | ファイル根拠                                                                                                                                                                                                 | Knowledge での扱い                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| room chat              | room/member/message、投稿・閲覧、mention、reaction、ack、未読、通知設定、論理削除                       | `packages/backend/prisma/schema.prisma` (`ChatRoom`〜`ChatReadState`)、`packages/backend/src/routes/chatRooms.ts`、`packages/frontend/src/sections/RoomChat.tsx`                                             | Chat を正本として維持し、thread/share は integration port 経由で追加する                                                                    |
| chat search            | `GET /chat-messages/search` と room ACL を通した検索                                                    | `packages/backend/src/routes/chatRooms.ts`、`packages/frontend/src/sections/room-chat/useRoomChatGlobalSearch.ts`                                                                                            | Knowledge search と table/index を共有しない。Global Search の aggregation は後続で追加する                                                 |
| ERP search             | project/invoice/estimate/expense/time entry/PO/vendor document の横断検索と audit                       | `packages/backend/src/routes/search.ts`、`packages/frontend/src/sections/GlobalSearch.tsx`                                                                                                                   | Knowledge result を追加する場合も Knowledge ACL predicate を route 内の後処理にしない                                                       |
| Chat ACL               | room type、project/group/member、viewer/poster、external user/integration 制御                          | `packages/backend/prisma/schema.prisma` (`ChatRoom`, `ChatRoomMember`)、`packages/backend/src/services/chatRoomAccess.ts`                                                                                    | share 後の表示には再利用するが、personal item の通常 read 権限には流用しない                                                                |
| Chat attachment        | upload scan、provider store、ChatAttachment row、監査、認可 download                                    | `packages/backend/src/routes/chat.ts`、`packages/backend/src/application/chat/chatAttachmentUseCases.ts`、`packages/backend/src/adapters/storage/chatAttachmentStorageAdapter.ts`                            | 現行の外部 storage→DB 順序を Knowledge PR で推測変更せず、#1982/#1983 と責務を分離する                                                      |
| break-glass            | request、二重承認、TTL、access log                                                                      | `packages/backend/prisma/schema.prisma` (`ChatBreakGlassRequest`, `ChatBreakGlassAccessLog`)、`packages/backend/src/routes/chatBreakGlass.ts`                                                                | 実装パターンは監査するが、Knowledge の規範は ADR に明記した二重承認/職務分離/owner通知/fail-closed access log とする                        |
| external LLM           | disabled/stub/openai、host/timeout 制限、redacted error、user/room rate limit                           | `packages/backend/src/services/chatExternalLlm.ts`、`packages/backend/src/services/safeHttpClient.ts`、`packages/backend/src/services/redaction.ts`                                                          | provider I/O の参考にする。Knowledge 固有 prompt/provenance/cost は別 port/use case とする                                                  |
| audit                  | actor/request metadata を含む共通 `logAudit`。現行 helper は DB failure を catch して業務処理を継続する | `packages/backend/src/services/audit.ts`、`AuditLog` in `packages/backend/prisma/schema.prisma`                                                                                                              | `AuditLog` は再利用するが、Knowledge 必須監査 write は transaction-aware で失敗を返す別 port とし、現行 fail-open helper をそのまま使わない |
| artifact metadata      | context/provider/status/idempotency/hash/owner を持つ `StorageArtifact`                                 | `packages/backend/prisma/schema.prisma` (`StorageArtifact`)                                                                                                                                                  | Knowledge binary context を additive に拡張する。Knowledge table に Drive ID を格納しない                                                   |
| artifact port/adapters | stream open/store、local/gdrive adapter。現行 `open` の owner scope は optional                         | `packages/backend/src/application/storage/artifactStoragePort.ts`、`packages/backend/src/adapters/storage/artifactStorageAdapter.ts`                                                                         | Knowledge context は owner scope 必須 wrapper を使い、shared port を route/use case から直接呼ばない                                        |
| Drive object store     | Shared Drive、retry/error normalization、stat/download/trash、checksum metadata                         | `packages/backend/src/infrastructure/storage/googleDriveObjectStore.ts`                                                                                                                                      | 低レベル I/O を重複実装しない。実 credential 成功は後続 target-environment evidence とする                                                  |
| storage readiness      | OAuth/quota/freshness/retention の scripts/docs/timer                                                   | `packages/backend/src/application/backup/storageReadiness.ts`、`packages/backend/src/cli/storageReadiness.ts`、`scripts/storage-readiness.sh`、`docs/ops/storage-readiness.md`                               | Knowledge 容量/失敗指標は workstream 11 から接続する                                                                                        |
| requirements / ops     | Chat API統合、外部LLM、Chat Drive、artifact lifecycle、実環境未検証範囲                                 | `docs/requirements/chat-api-unification-inventory.md`、`docs/requirements/chat-external-llm.md`、`docs/requirements/chat-attachments-google-drive.md`、`docs/requirements/storage-artifacts-google-drive.md` | 文書だけを現状とみなさずコードと照合する。fake/local test を実 Drive/target-environment 成功と扱わない                                      |

### 2.2 未実装

次は baseline に存在しない。

- KnowledgeItem/Snapshot/Label/Annotation/Conversation/Synthesis/SavedView/Share 専用 Prisma model
- Knowledge CRUD、label ANY/ALL/NOT、saved view、snapshot、share/promote API
- Knowledge Inbox/Search/Detail/Label/Conversation/Share UI
- immutable Knowledge share card と chat thread/reply structure
- Knowledge 固有の ACL policy、break-glass、audit event、redaction test matrix
- AI token/cost reservation、hard limit、provenance
- Knowledge import/export、capture extension/share target
- Knowledge metadata と binary reference を対象にした backup/restore rehearsal

`rg` で名前がないことだけを将来の仕様根拠にせず、後続 Issue の開始時に最新 `origin/main` を再監査する。

### 2.3 文書と実装の差異

`docs/requirements/project-chat.md` は検索を未実装としていたが、現行 main には `GET /chat-messages/search` と `GET /search`、対応 frontend が存在する。本 Issue で「実装済み」と「検索 index 高度化」に分けて同期する。

### 2.4 既存 Issue との境界

| Issue                | 既存責務                                                                                    | Knowledge workstream がしてはいけないこと                                  |
| -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| #1975 / #1981 / #544 | Google Drive/object storage、copy-only migration、実 backup/upload/download/restore/cutover | Knowledge 専用 Drive adapter、実 credential 成功の代替、production cutover |
| #1982                | Chat attachment の external upload 後 DB failure reconciliation                             | Chat の failure semantics を Knowledge snapshot PR で推測変更する          |
| #1983                | Drive write probe の結果不明/trash failure recovery                                         | operator recovery を Knowledge runtime の自動 retry へ置き換える           |
| #1875                | production Go/No-Go と target environment                                                   | repo-side fake/local test を production readiness と扱う                   |
| #1903 / #1904        | Sakura VPS lifecycle、FQDN/OAuth/access restriction                                         | WSL2 または docs 成功で Sakura evidence を close する                      |

## 3. Entity データ分類

### 3.1 共通原則

- `personal` は owner だけが通常 read/write できる application-level private scope である。
- `organization` は明示 ACL/grant を要求し、role 名だけで全件閲覧を許可しない。
- Chat 共有は選択 field の immutable share snapshot であり、元 item への権限移譲ではない。
- text、URL、annotation、AI turn、binary は confidential を既定分類とする。share/export 前に field 単位の明示選択を要求する。
- MVP は logical delete と監査保全を行い、自動物理削除をしない。backup は既存 ERP4/Storage 方針に従う。

### 3.2 Entity matrix

| Entity                           | owner / scope                                            | 通常 read/write                                                            | share / export                                               | delete / retention / backup                                | redaction 要件                                                        |
| -------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| KnowledgeItem                    | creator owner、personal/organization                     | personal は owner、organization は grant policy。scope 移行は専用 use case | field 選択 preview 後だけ。item row 自体は Chat へ公開しない | logical delete。自動物理削除なし。DB backup 対象           | canonical URL の credential/query、secret 様値を log/audit へ出さない |
| KnowledgeSnapshot                | item scope、immutable                                    | item ACL + version owner relation                                          | snapshot 本体ではなく share snapshot/export manifest を作る  | append-only、logical revoke。DB metadata + artifact backup | source HTML active content を実行せず、表示用を sanitize              |
| KnowledgeLabel / ItemLabel       | personal label は owner、organization label は管理 grant | label 名・件数・候補にも scope predicate                                   | 選択 label だけ share。personal label は既定除外             | item relation は論理 detach/audit。master 物理削除なし     | label 名から personal item の存在を漏らさない                         |
| KnowledgeAnnotation              | author、item scope                                       | author/ACL policy。別 entity として version/audit                          | annotation ごと opt-in                                       | logical delete、DB backup                                  | 本文を application log/audit metadata に複製しない                    |
| KnowledgeConversation / Turn     | owner、関連 item ACL の共通部分                          | owner と明示 grant。system/tool turn も source を保持                      | 全文は既定非共有。選択 summary/turn だけ                     | logical delete、provider 応答とは独立して DB backup        | prompt、API key、生 provider error を log に出さない                  |
| KnowledgeSynthesis / Source      | author、personal/organization                            | synthesis ACL + 全 source の参照可否を再検証                               | version を固定して選択共有                                   | append version、旧版保持                                   | source が非共有なら本文を自動展開しない                               |
| KnowledgeSavedView               | owner、必要なら organization grant                       | filter definition 自体も owner/ACL 対象                                    | personal view は共有しない。organization 化は明示 copy       | logical delete、DB backup                                  | filter 中の personal label/ID を log に出さない                       |
| KnowledgeShare                   | sharer、対象 Chat room                                   | sharerは source read + room post、viewer は room read                      | 選択 field の immutable snapshot が表示正本                  | revoke event は可能、過去監査は保持                        | provider key、非共有 field、private label/turn を含めない             |
| Chat thread / promoted synthesis | Chat room ACL / promoter                                 | Chat thread は room ACL、promote は source read + Knowledge write          | 選択 message snapshot のみ                                   | Chat retention と Knowledge synthesis version を別管理     | thread 全文を暗黙複製しない                                           |

## 4. ACL 非漏えい matrix

| 経路                                            | 必須条件                                                              | negative contract                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| list / pagination / count                       | query 内に owner/scope/grant predicate                                | 権限外 row を total、cursor、facet に含めない                                   |
| detail                                          | actor context + item policy + deleted/revoked state                   | 権限外 ID の存在、scope、updatedAt を返さない                                   |
| search / label filter                           | text/label predicateより前提として ACL predicateを同じ query に含める | 検索後 filter 禁止。ANY/ALL/NOT、descendant label、saved view も同一            |
| suggestion / autocomplete / related / duplicate | candidate source を ACL 済み relation に限定                          | title、label、hash、URL、候補件数を漏らさない                                   |
| AI input                                        | actor read、external AI enable、field selection、budget reservation   | hidden snapshot、attachment、conversation、label を prompt に含めない           |
| share preview / card                            | source read + destination post + explicit field selection             | preview 自体に非選択 field を返さず、card から source endpoint を bypass しない |
| export                                          | owner/organization export grant + re-auth/confirmation + manifest     | count-only preflight でも権限外を含めない。provider key/Drive URLを出さない     |
| audit/application log/error                     | audit policy と allowlist metadata                                    | URL query、本文、AI prompt/response、provider ID、secret を出さない             |
| artifact download                               | item/snapshot ACL + artifact owner type/ID + ready status             | storage URL/keyを返さず、metadata一致だけで content を許可しない                |
| delete / restore                                | ownerまたは明示管理 policy、version check、audit                      | admin roleのみの personal restore/readを許可しない                              |
| break-glass                                     | reason、二重承認、viewer、target、TTL、read-only access log           | grant を検索/export/AIへ自動拡張しない                                          |

authorization service がエラー、grant 不整合、actor 欠落になった場合は fail closed とする。権限外と存在しない resource の外部 error contract を同等にする endpoint は、監査内部だけで理由を区別する。

## 5. Audit event matrix

event 名は後続 Issue で repository 命名規則へ合わせるが、少なくとも次を一件の actor/action/result として記録する。

| 操作                       | 成功時 metadata（allowlist）                                                                 | 失敗時に残すもの                             | 本文へ残さないもの                 |
| -------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| create/update/status/scope | target type/id、scope、version、changed field names                                          | result code、policy reason code              | old/new text、URL query            |
| snapshot append/capture    | item id、snapshot id/version、source type、size、SHA-256、artifact id                        | sanitized capture/storage code               | source body、provider key          |
| label attach/detach        | item id、label id、source(manual/AI)、actor                                                  | policy/conflict code                         | personal label display name        |
| external AI send           | conversation/request id、provider/model、selected source ids、token/cost reservation、result | timeout/quota/budget/sanitized provider code | API key、prompt/response、生 error |
| share/revoke               | source item/version、share id、destination room id、selected field names                     | authorization/destination/result code        | 非共有 field、room member list     |
| export/import              | job id、format、item count、manifest hash、result                                            | validation/idempotency code                  | export content/path credential     |
| logical delete/restore     | target/version、reason code、result                                                          | policy/version conflict                      | deleted body                       |
| break-glass                | request/grant id、target、approvers、viewer、TTL、access type                                | denial/expiry code                           | reason text の一般表示、content    |

現行 `logAudit()` は失敗を catch して継続するため、Knowledge の必須監査 write にはそのまま使用しない。Issue 02（#2010）で、同じ Prisma transaction を受け取り失敗を呼び出し元へ返す `KnowledgeAuditWriter` 相当の portを実装し、成功する業務rowとaudit rowを同時にcommit/rollbackする。権限拒否、hidden/absent、version conflict、route/schema denialの監査は、外部非漏えいcontract、失敗監査自体のfailure semantics、ID probingによるlog増幅対策を先に固定する必要があるため#2025で実装する。既存moduleのfail-open契約は変更しない。

storage、AI、Chat 等の外部副作用では DB transaction を開いたまま I/O を待たない。副作用前に intent/status と監査 event を transaction で確定し、副作用後の finalization/audit が失敗した場合は success を返さず、`pending|failed` と idempotent reconciliation を残す。break-glass access、export、外部 AI 送信、binary download は実アクセス監査を必須とし、監査不能時に操作を開始または成功応答しない。通常 read の監査方式は対象 Issue で可用性影響とともに明示する。

Knowledge audit metadata は event ごとの typed allowlist から構築し、保存前に redaction/length bound を適用する。現行 route の任意 metadata pass-through や検索語保存を Knowledge 実装へコピーしない。

Knowledge item の logical delete 理由は自由記述ではなく有限のreason code allowlistとし、Workstream 02では `owner_request` のみを受け付ける。request、response、application port、Prisma adapter、Knowledge audit writerを同じallowlistへ揃え、`KnowledgeItem.deletedReason`はDB enum、削除状態はCHECK、共用`AuditLog`は`knowledge_item_deleted` actionだけに適用する条件付きCHECKでfail closedにする。本文、説明文、credentialは`deletedReason`または`AuditLog.reasonCode`へ保存しない。後続reason codeは要件・API schema・DB enum/CHECK・負例テストを同時に更新する場合だけ追加する。

## 6. 費用・運用契約

### 6.1 責任

- `admin`: external AI の有効化、provider/model allowlist、user/org rate、soft/hard monthly limit を設定する。
- `mgmt`: 利用量、推定費用、soft/hard limit 状態、保存容量、失敗率を参照する。limit 引き上げは管理者と業務責任者の承認記録を要求する。
- application: request 前の budget reservation と hard stop、完了時の usage reconciliation、監査を行う。
- operations: Drive quota、storage failure、backup freshness、検索 latency を監視する。credential 値や identifier を監視 payload に含めない。

### 6.2 上限

- 既存 ERP4/Google Workspace を除く月額増分目標は 5,000 円。
- external AI は既定 disabled。hard limit 未設定、usage 不明、reservation 不可のいずれかなら request 前に拒否する。
- soft limit は警告と UI 表示を行うが、hard limit は副作用前に停止する。
- user/org の request、input/output token、推定費用、provider/model、status を月単位に集計する。
- snapshot の件数、論理/物理 byte、最大 item size、保存失敗、quota、検索 p50/p95 を観測対象にする。
- 自動 label/summary/related candidate は既定 OFF または利用者の一回の明示操作に限定し、無制限 batch を作らない。

専用検索基盤、vector DB、queue、追加 VPS、追加 SaaS は、計測値、月額、運用負荷、security/backup/rollback を示した別 ADR/Issue の承認なしに導入しない。

## 7. Workstream 02〜12 の子 Issue 案

各 workstream は開始時に最新 main と重複 Issue を再確認する。原則一 Issue 一 branch/PR とし、大きい場合は同じ受け入れ条件を維持して `Refs` 中間 PR と `Closes` 最終 PR に分割する。

### 02. Core schema / repository / CRUD

- Depends on: 01 (#2007)
- 目的: additive Prisma schema、migration、Knowledge authorization/repository port、personal/organization CRUD API を実装する。
- 非対象: label search、binary snapshot、Chat、AI。
- 受け入れ: owner 外 list/detail/count 0、optimistic concurrency、logical delete/restore、transaction-aware fail-closed audit port、typed audit metadata allowlist、OpenAPI/schema、既存 chat migration 回帰なし。
- rollback/test: expand-only migration、旧 image 互換、migration deploy、repository/service/route/ACL negative tests、API schema、backup前提記録。

#### Workstream 02 API / authorization contract

- APIは `POST /knowledge/items`、`GET /knowledge/items`、`GET /knowledge/items/count`、`GET|PATCH|DELETE /knowledge/items/:id`、`POST /knowledge/items/:id/restore` とする。
- `personal` のread/writeはowner subjectをDB predicateへ含め、`admin` / `mgmt` roleだけの通常閲覧を許可しない。JWT/sessionのDB canonical contextでは可変な`externalId` / `userName`ではなくstableな`UserAccount.id`を`ownerUserId`へ保存・照合する。development/test専用header authだけはsynthetic `UserContext.userId`へfallbackする。non-header authはactiveな`UserIdentity`に裏付けられたcanonical `UserAccount.id`と`identityId`を必須とし、解決できない場合はKnowledge route全体を`403 forbidden`（`canonical_account_required`）でfail closedとする。既存API互換の`userName` / `externalId`解決結果やJWT subjectをKnowledge owner/audit主体へfallbackしない。
- `organization` の通常readはowner、またはitemの `organizationId` とactorの `orgId` が一致し、かつactiveなcanonical `GroupAccount.id` の明示grantが一致する場合だけ許可する。org/group context欠落、inactive group、壊れたrelationはdenyする。
- JWT/sessionのorganizationとcanonical group IDはDB解決成功時にDB正本へ置換し、stale token claimをACLへ使わない。正のDB context cache TTLを使う場合もidentity-backed entryの期限を`UserIdentity.effectiveUntil`で上限設定し、identity失効後のKnowledge actor再利用を拒否する。session認証のcache keyはcanonical identity/account単位で分離し、同じprovider subjectを持つ別identityの正・負contextを共有しない。DB解決中にsubject/global invalidationが発生した場合は、失効前snapshotをcacheへ書き戻さない。header authはdevelopment/test用のsynthetic trust boundaryであり、productionはenv validationで`AUTH_MODE=jwt_bff`以外を起動拒否する。
- organization item作成時はactor自身のactive `groupAccountIds` に含まれるgrantを1件以上要求する。WS02のgrantはread-onlyで、update/delete/restoreはownerだけに限定する。
- JWT/sessionでDB user contextを解決できた場合、`orgId`、`groupIds`、`groupAccountIds`およびgroup由来roleはDB正本で置換し、signed tokenのstale group claimをunionしない。独立したrole claimは既存認証契約として保持する。development/test専用header authはsynthetic contextをそのまま信頼し、DB canonical化を行わない。
- scopeとgrantの変更をgeneric PATCHへ含めない。personalからorganizationへの移行、grant管理、共有field選択はWorkstream 07の専用preview/confirm use caseで扱う。
- create/update/delete/restoreのrequest bodyは、Fastify/Ajvが未知fieldを除去する前の`preValidation`境界で明示allowlistと照合し、owner/audit field等の未知fieldが1件でもあればrequest全体を`400 invalid_request`で拒否する。application service直呼びでも同じく未知fieldを拒否し、許可fieldだけを部分適用しない。
- update/delete/restoreは、increment後もPostgreSQL `INTEGER`範囲内となるpositive integer（1〜2,147,483,646）の `expectedVersion` を必須とする。2,147,483,647はoverflowを防ぐためmutation前に`400 invalid_request`で拒否する。stale owner requestは`409 version_conflict`、owner外または存在しないIDは同じ`404 not_found` contractとする。
- updateは正規化後の実値を現行rowと比較し、同一値だけのPATCHは`400 invalid_request`としてversionとauditを進めない。実変更と同一値が混在するPATCHは実変更fieldだけを更新し、`changedFields`へ記録する。
- logical delete後は通常list/count/detailから除外する。restoreはowner、deleted state、version一致を同じtransaction内で検証する。
- create/update/delete/restoreは、業務rowとallowlist metadataだけの `AuditLog` を同じPrisma transactionでcommitする。監査失敗時はbusiness writeもrollbackし、既存fail-open `logAudit()` は使用しない。
- audit metadataはscope、status、version、変更field名だけを許可し、本文、canonical URL、query、reason text、token ID、secretを含めない。actor provenanceの`userId`はapplication serviceが認可済みowner subjectから強制導出し、caller指定値を受け付けない。安全文字・128文字上限をadapterでも再検証したrequest ID、有限値`api|agent`のsourceだけを追加保存する。raw role/group display name/scope/IP/User-Agentは利用者・issuer由来の自由文字列を含み得るためKnowledge audit port/DBへ渡さない。
- canonical URLはHTTP(S)だけを受け付け、userinfo、安全なfragment、既知tracking parameterを除去する。署名URLの`key` / `policy` / `expires`、OAuthの`state` / `code`を含む署名・token・credential・session・OAuth等のcredential-like queryは、値の内容が一見無害でもfail-closed境界としてURL全体を拒否する。query名は入力長から導出した有限回数ですべての多重percent-encoding層をdecodeしたうえで、separatorとcamel-case境界でもtoken化し、`auth_key`、`x_sig`、`privateKey`、`privatekey`、password別名の`pwd` / `passphrase`、OAuthの`client_assertion` / `code_verifier` / proof系、SAMLの`SAMLRequest` / `SAMLart` / `RelayState`等の別名化で回避できないことを負例で固定する。標準の`&`だけでなくsemicolon区切り、およびpercent-decoding後に現れる埋め込み区切りもfail closedで検査する。query値は多重percent-decodeし、先頭からcredential-likeな`name=value`を含む場合は安全なouter query名の配下でも拒否する。query値に埋め込まれたHTTP(S)/relative URLとtop-level hash-router fragmentは同じ有限decoderへ通し、delimiter自体の多重encodingやmalformed prefixを含めて解析する。先頭slashのないpath-relative参照でURL parserを迂回してもcredential-like query textを拒否し、解析上限へ到達する防御経路はfail closedとする。
- Workstream 02はDB metadataだけを追加し、binary snapshot、artifact、provider URL、Chat share、label、AIを扱わない。

### 03. Label / ANY-ALL-NOT search / saved view

- Depends on: 02
- 目的: personal/organization label master、多対多付与、alias/parent、ANY/ALL/NOT、saved view を実装する。
- 非対象: vector search、自動 AI label。
- 受け入れ: JSON array を正本にしない、descendant option、source/status/date/scope filter、ACL 済み count/facet、stable pagination、query cost limit。
- rollback/test: additive indexes、query plan/性能 fixture、cross-owner label/suggestion leakage negative tests、saved-view ownership tests。

#### Workstream 03 PR1: label core contract

Issue #2011は、一つの巨大PRではなく次の2段階で実装する。PR1はlabel masterとassignmentのtransaction/ACL境界を先に固定し、PR2だけが検索・facet・suggestion・saved-view runtime APIを有効化して`Closes #2011`とする。PR1は`Refs #2011`であり、PR1単独ではIssueをcloseしない。

PR1のDB正本は次の7 relationであり、label ID arrayやsaved-view filter JSONを正本にしない。

- `KnowledgeLabel`: stable owner、`personal|organization` scope、organization、display name、slug、parent、version、logical delete
- `KnowledgeLabelAlias`: 表示aliasとNFKC/case正規化値
- `KnowledgeLabelPath`: self rowを含むclosure path
- `KnowledgeItemLabel`: item-label relation、assignment source、assigner、AI confidence、logical detachの時刻/実行者。detach後のprovenance rowを保持し、active relationだけをpartial unique indexで一意にする
- `KnowledgeLabelGroupGrant`: canonical `GroupAccount.id`単位のactive `use|manage`
- `KnowledgeSavedView`: owner、source/status/date/scope filter、schema/version、logical delete
- `KnowledgeSavedViewLabelFilter`: saved view、label、`any|all|not`、descendant option

所有・ACL契約:

- `personal` labelはstable canonical `UserAccount.id` ownerだけがread/use/manageできる。`admin` / `mgmt` roleやgroup grantで通常アクセスを拡張しない。
- `organization` labelのread/useには、actorのorganization一致とactiveな明示`use`または`manage` grantを同時に要求する。`manage`は`use`を包含するが、`use`はmaster mutationを許可しない。
- organization labelのmaster mutationは、同一organizationの作成ownerまたはactiveな`manage` grantに限定する。grant欠落、無効化、別organization、canonical actor欠落はfail closedとする。
- label ownerまたは`manage` grant保有者は、所属外を含むactive groupへ`use|manage`を委譲できる。grant設定者自身のgroup membershipは委譲先の認可条件にしない。受領側のread/useではactorのorganization一致、現在のgroup membership、group/grantのactive状態を常に再評価するため、別organizationのactorや失効済みmembershipへアクセスを拡張しない。
- detail、alias、grant、attach/detachでは、hidden、logical deleted、revoked、cross-domain、存在しないlabelを外部から区別せず`404 not_found`とする。
- itemへのattach/detachは、item owner、item version、label use権限を同じserializable transaction内で評価する。item versionとlabel master versionは別契約であり、attach/detach成功時はitem versionだけを進める。
- grant revokeまたはlabel logical deleteは、既存item-labelをcascade detachせずprovenanceとして保持する。現在有効なassignmentとしてread/search/countへ採用するには、`detachedAt IS NULL`だけでなくlabelの非削除とactorのcurrent visibility/use ACLを同じqueryで満たす必要がある。grant再有効化では保持済みassignmentが再び有効になり、hidden/revoked/deleted中のdetach cleanup APIはlabel存在判定のoracleとなるため提供しない。
- mutation対象のlabel/item row lockは、生IDだけを先にlockせず、owner/organization/group/deleted predicateを含む単一`SELECT ... FOR UPDATE|SHARE`の結果にだけ適用する。権限外の既存rowと不存在IDのlock待ち時間差を作らない。

master・階層・競合契約:

- label create/update/delete、alias追加/削除、grant全置換はoptimistic `expectedVersion`を使い、increment可能なPostgreSQL `INTEGER`上限（2,147,483,646）を超える入力をmutation前に拒否する。
- display name、slug、aliasはdomain内で正規化済みcanonical namespaceを共有し、曖昧な重複を`409 label_conflict`とする。active slugはDB partial unique indexでも保護する。
- closure pathは各labelに`ancestorId = descendantId`かつ`depth = 0`のself rowを1件持つ。reparentはactorが現在manageできるsubtree rowだけをACL修飾済みqueryでlockし、subtree全件をmanageできない場合はclosure pathを変更せずgeneric `409 version_conflict`でfail closedとする。全件認可後にpathを同一transactionで再構築し、cycle、別scope/owner/organization、壊れたpath、depth 8超過を拒否する。
- Serializable conflict、adapter-pgのSQLSTATE `40001`、deadlock `40P01`、unique raceはDB transactionだけを最大3回再評価する。成功済み外部副作用はretry対象に含めない。上限到達時はraw Prisma errorやDB詳細を返さず、canonical label name/slug/alias namespaceのunique競合は`409 label_conflict`、その他の並行競合は`409 version_conflict`へ正規化する。active item-label assignmentの重複だけは通常検出とunique retry枯渇を同じ`400 invalid_request`（`label is already attached`）とし、label master名競合と混同しない。
- active childを持つlabelはlogical deleteできない。PR1はlabel masterやassignmentを物理削除しない。
- business row、version更新、closure path、grant/assignment、Knowledge専用auditは同じtransactionでcommitし、audit失敗時もbusiness writeをrollbackする。

PR1 API:

- `POST|GET /knowledge/labels`
- `GET|PATCH|DELETE /knowledge/labels/:id`
- `GET|POST /knowledge/labels/:id/aliases`
- `DELETE /knowledge/labels/:id/aliases/:aliasId`
- `GET|PUT /knowledge/labels/:id/group-grants`
- `POST /knowledge/items/:id/labels`
- `DELETE /knowledge/items/:id/labels/:labelId`

public attach APIは利用者操作の`manual` assignmentだけを作る。`assignmentSource=import|ai_suggestion`と`confidenceBasisPoints`は、将来の信頼済みimport/AI use caseがapplication portを呼ぶための内部契約であり、利用者request bodyから指定できない。responseは保存済みprovenanceを型付きで返す。

監査・privacy契約:

- label master auditは共有`AuditLog`の`targetTable=knowledge_labels`、`targetId=label_master`という一定markerを使い、raw label ID、label名、slug、alias、grant principal、検索語、filter bodyを保存しない。
- item-label attach/detach auditはactorが認可済みの`knowledge_items` / item IDをtargetにできるが、label IDや名称はmetadataへ保存しない。
- metadataはscope/status/version、bounded relation count、有限assignment sourceだけのallowlistとする。request ID/sourceはWorkstream 02と同じ検証済みactor contextを使う。
- API responseにstorage URL、provider key、credentialを追加しない。本workstreamはGoogle Drive、Sakura Object Storage、production credentialへ接続しない。

移行・rollback契約:

- migrationは新enum/table/index/FK/CHECKだけのexpand-only変更とし、既存`KnowledgeItem`、`GroupAccount`、Chat、共有audit rowを更新・削除しない。
- PR1適用後DBへWorkstream 02 merge artifact `358cb9e4d13489b703cb71cfee4b2754d15aa53e`の旧Prisma client/applicationを接続し、既存WS02 data保持、CRUD、health/readinessを確認する。
- application rollbackでは7 tableと新enumを保持したまま旧imageへ戻す。table drop、migration逆適用、既存row削除をrollback手順にしない。
- label/saved-view metadataとassignment/grant/auditは既存PostgreSQL backup bundleの対象である。PR1はbinary artifactや外部provider objectを追加しない。

PR2へ残す範囲:

- canonical ANY/ALL/NOTと`includeDescendants`
- item検索、total、facet、suggestionのassignment集合は必ず`KnowledgeItemLabel.detachedAt IS NULL`のactive relationだけから導出し、logical detach済みprovenanceを現行label usageへ含めない
- source/status/published/captured/scope filter
- ACL predicateを同一queryへ含めるcount/facet/suggestion
- query-cost guard、query/scope-bound signed cursor、stable pagination
- saved-view CRUD/replayと、再生時点ACLによるlabel/filter再検証
- query-plan/performance fixtureおよびcross-owner count/facet/suggestion leakage negative test

### 04. Snapshot / artifact / manual capture

- Depends on: 02、#1975 repository-side storage boundary
- 目的: immutable snapshot/version/hash、text/PDF/image/manual capture、既存 artifact port、認可 download を実装する。
- 非対象: SNS API巡回、実 Drive cutover、source delete。
- 受け入れ: size/type/timeout、SSRF/redirect/private IP/active content対策、caller側 bounded stream/content-type検証、owner-scoped Knowledge artifact wrapper、pending/ready/failed reconciliation、provider URL非公開、manual capture UI。
- rollback/test: fake/local storage、checksum/idempotency/partial failure、owner scope省略不能、owner跨ぎidempotency collision、download ACL、oversize/content-type拒否、sanitized UI evidence。実 credential は別証跡。

### 05. Annotation / conversation import / synthesis

- Depends on: 02（binary attachment参照は04）
- 目的: annotation、conversation/turn、item relation、versioned synthesis/provenance を実装する。
- 非対象: external LLM runtime、自動 ChatGPT session取得。
- 受け入れ: role/source分離、複数item relation、Markdown/JSON/manual import、引用と本人/AI/外部情報のUI区別、idempotent import。
- rollback/test: parser bounds、malformed/oversize input、cross-owner relation拒否、version/history、sanitized fixtures/UI evidence。

### 06. Chat thread foundation

- Depends on: 01。Knowledge schema とは独立して実装可能
- 目的: `ChatMessage` の後方互換 thread/reply、mention/notification/reaction/search/unread/ack を整合させる。
- 非対象: Knowledge share card/promote。
- 受け入れ: root/reply contract、既存messageはroot表示、room ACL、reply count/last activity、既存project alias、全chat回帰/E2E。
- rollback/test: expand migration、旧 client 応答互換、thread authorization、unread/notification/search/ack regression、application rollback。

### 07. Knowledge share / Chat card / promote

- Depends on: 03、04、05、06
- 目的: field-selective immutable share snapshot、knowledge card、threadからsynthesisへの明示promoteを実装する。
- 非対象: automatic share/post、元 personal item の権限移譲。
- 受け入れ: preview/confirm、source read + destination post、非共有field 0、room-only viewer、revoke event、selected messages/version provenance。
- rollback/test: source削除/権限変更後card、cross-room access、personal label/AI turn leakage、Chat failure pending/failed、E2E/UI evidence。

### 08. External LLM common boundary / AI dialogue / cost guard

- Depends on: 04、05。手動 import/stub MVP が先
- 目的: provider port、selected-context prompt、監査、rate、timeout、token/cost reservation/limit を実装する。
- 非対象: autonomous sharing、unbounded batch、ChatGPT cookie、production key。
- 受け入れ: default disabled、preview/confirm、allowlist、minimal send、provider/model/usage/cost provenance、hard stop、結果/usage不明時のreservation保留と自動再送禁止、no fallback。
- rollback/test: stub/fake provider、timeout/quota/malformed response、budget race、usage不明reconciliation、redaction、secret scan。実 provider evidence は別承認。

### 09. Chrome/Edge capture extension / PWA share target

- Depends on: 04
- 目的: 利用者が表示中の URL/選択範囲/metadata を inbox へ短い操作で送る。
- 非対象: authenticated page server scraping、SNS API monitoring、browser credential取得。
- 受け入れ: origin/permission最小化、user gesture、scope preview、idempotency、offline/duplicate/error UX、extension/PWA threat model。
- rollback/test: permission manifest review、malicious page payload、size/encoding、CSRF/session、browser compatibility、manual evidence。

### 10. Chatwork / Markdown / JSON import-export

- Depends on: 04、05
- 目的: portable manifest/checksum、Knowledge/item/user export、ChatGPT/Chatwork/manual import boundary を実装する。
- 非対象: GitHub/Markdownの正本化、production一括移行。
- 受け入れ: schema version、SHA-256、dry-run、idempotency、duplicate report、ACL/ownership mapping、partial failure manifest、round-trip。
- rollback/test: synthetic fixtures、malformed/zip bomb/path traversal、resume、same input replay、export非漏えい、no source delete。

### 11. Observability / capacity / backup-restore Runbook

- Depends on: 03、07〜10 の対象機能、#1975 storage/backup boundary
- 目的: storage/AI/search metrics、freshness/retention、backup/restore整合、Runbook/evidence template を整備する。
- 非対象: credential公開、production cutover、実restoreの無承認実行。
- 受け入れ: sanitized readiness、alert threshold、metadata↔artifact manifest、stale/missing/orphan検知、dry-run、target-environment evidence分離。
- rollback/test: ops-quality、script tests、synthetic backup、isolated restoreは人間承認後。fake/localを実環境成功と表現しない。

### 12. Pilot / usability / performance / Go-No-Go

- Depends on: 02〜11
- 目的: synthetic/pilot dataで業務flow、非漏えい、検索品質/性能、費用、運用性を評価しGo/No-Goを記録する。
- 非対象: 計測前の検索/infra置換、無承認production rollout。
- 受け入れ: capture→review→share→thread→promote、ACL E2E、p50/p95、search relevance、月額見積、backup/restore evidence、rollback drill、残リスク/owner。
- test/evidence: sanitized screenshots/report、exact commit/image、required CI/E2E。#1875のproduction gateを置き換えない。

## 8. 依存 DAG

```text
01 #2007
├─► 02 core ─► 03 labels/search
│        ├─► 04 snapshot/storage ─► 09 capture
│        └─► 05 annotation/conversation
├─► 06 chat thread
│
├─► 03 + 04 + 05 + 06 ─► 07 share/promote
├─► 04 + 05 ──────────► 08 external AI
├─► 04 + 05 ──────► 10 import/export
└─► 03 + 07 + 08 + 09 + 10 ─► 11 operations ─► 12 pilot/Go-No-Go
```

02/03を先に正本/検索境界として安定させる。04/05と独立な06は並行可能だが、07は03/04/05/06の merge 後に開始する。08は04/05の手動 import/stub で MVP を成立させた後に開始する。11は03の検索計測契約を含む全対象機能の merge 後に開始する。

## 9. #2007 完了判定

- [x] exact main SHA と実装済み/未実装をファイル根拠付きで記録した
- [x] project-chat の検索記述を現行実装へ同期した
- [x] #1975/#1981/#1982/#1983/#1875/#1903/#1904/#544 との境界を記録した
- [x] bounded context、正本、storage/search/chat/AI/migration 境界を ADR に記録した
- [x] entity 分類、read surface ACL、audit/redaction/SSRF/active-content/download を定義した
- [x] 月額増分目標、AI hard-stop、設定/承認/運用責任を定義した
- [x] workstream 02〜12 の目的、非対象、依存、受け入れ、rollback/test 案を定義した
- [x] schema、migration、runtime API/UI、実 credential を変更していない

merge 前には docs format/link、secret scan、独立 security/design review、全 review thread、required CI を確認する。
