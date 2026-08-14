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
- `organization` の通常readはowner、またはitemの `organizationId` とactorの `orgId` が一致し、かつactiveなcanonical `GroupAccount.id` の明示grantとactorのcurrent `UserGroup` membershipが同じDB snapshot内で一致する場合だけ許可する。membershipの`UserAccount`もactive、非削除、同一organizationであることを再検査する。org/group context欠落、inactive group、失効済みmembership、壊れたrelationはdenyする。
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
- closure pathは各labelに`ancestorId = descendantId`かつ`depth = 0`のself rowを1件持つ。reparentはactive subtree rowだけをactorのcurrent manage ACLで修飾したqueryでlockし、active subtree全件をmanageできない場合はclosure pathを変更せずgeneric `409 version_conflict`でfail closedとする。logical deleted descendantはmutation不能なtombstoneとしてlock待ち対象から除外するが、provenanceとclosure整合性を保つためpath再構築対象には含める。全active row認可後にpathを同一transactionで再構築し、cycle、別scope/owner/organization、壊れたpath、depth 8超過を拒否する。
- Serializable conflict、adapter-pgのSQLSTATE `40001`、deadlock `40P01`、unique raceはDB transactionだけを最大3回再評価する。成功済み外部副作用はretry対象に含めない。上限到達時はraw Prisma errorやDB詳細を返さず、canonical label name/slug/alias namespaceのunique競合は`409 label_conflict`、その他の並行競合は`409 version_conflict`へ正規化する。active item-label assignmentの重複だけは通常検出とunique retry枯渇を同じ`400 invalid_request`（`label is already attached`）とし、label master名競合と混同しない。
- active childを持つlabelはlogical deleteできない。delete時はactive child全件に対するactorのcurrent manage ACLを同一aggregate queryで評価し、全件をmanageできる場合だけ具体的な`has_active_children`拒否とする。hiddenまたはmanage不能なactive childが1件でもある場合は、子の存在・件数・権限を細分化しないgeneric `409 version_conflict`でfail closedとする。PR1はlabel masterやassignmentを物理削除しない。
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

#### Workstream 03 PR2: search / suggestion / saved-view runtime contract

PR2は次のAPIを有効化し、本節の完了をもってIssue #2011をcloseする。

- `POST /knowledge/search`: typed filter、requested facet、page limit、opaque cursorをbodyで受け取る
- `POST /knowledge/labels/suggestions`: 検索語をURLへ置かないbody-based候補検索
- `GET|POST /knowledge/saved-views`: owner-only list/create
- `GET /knowledge/saved-views/recovery`: current filterを返さず、ownerがstale viewを全置換または削除するための`id|name|version|updatedAt`だけを返すowner-only recovery metadata
- `GET|PUT|DELETE /knowledge/saved-views/:id`: owner-only detail/full replacement/logical delete。DELETE成功時は`204 No Content`とし、stale filterやcanonical label IDを応答へ含めない
- `POST /knowledge/saved-views/:id/execute`: 保存済みfilterをcurrent ACLで再評価して検索する

検索実行は、canonical label解決、current ACLによるdescendant展開、検索statementを同じPostgreSQL Repeatable Read snapshotで行う。current item ACL、非削除label、activeなgroup/grant、`KnowledgeItemLabel.detachedAt IS NULL`を含む検索本体は単一SQL statementを使用する。最初にdistinctなACL済みmatched item IDのCTEを構成し、page、limit適用前total、要求されたfacetを同じmatched集合から導出する。facetは`sourceType|status|scope|label`に限定し、label facetは可視labelを最大100 bucket返す。search、suggestion、saved-view executeにはproductionで有効な`RATE_LIMIT_SEARCH_*`のroute-level制限を適用し、未指定時はclient IPあたり60 request/minuteとする。

label入力はID、display name、slug、aliasをvisible canonical root IDへ解決する。曖昧または不可視な参照は候補を開示せず`invalid_request`とする。同じcanonical rootが複数operatorに現れる場合を拒否するが、descendant展開後の集合重複は拒否しない。これにより`ANY(ancestor, descendants)`と`NOT(child)`を「ancestor subtreeのうちchild以外」として扱える。`ALL`はrootごとのexpanded setに対する`EXISTS`であり、全descendant assignmentを要求しない。

query costはitem/count/facet statement前に判定する。operator参照合計30、descendant root 20 unit、ANY 1 / ALL 2 / NOT 2 unit、facet 5 unit、page 10件ごと1 unit、合計100 unit、visible expanded ID 100、page 100、suggestion 20を上限とする。hidden subtree sizeをcostへ含めず、上限超過は`query_too_complex`へ正規化する。suggestionの正規化後queryは2〜200文字とし、1文字の低選択率contains scanを拒否する。

pagination順序は`updatedAt DESC, id DESC`とする。cursorは`{v,updatedAt,id,filterHash,actorScopeFingerprint}`をbase64url payload + HMAC-SHA256 signatureとして保持する。filter hashはcanonical root/filter/facet/page size、actor fingerprintはcanonical user、nullable organization、sort/dedup済みgroup scopeを束縛し、raw principalをpayloadへ入れない。malformed、署名、version、filter、scope、boundary mismatchはすべて`invalid_cursor`とする。

`KNOWLEDGE_CURSOR_SIGNING_SECRET`は設定する全modeでUTF-8 32 bytes以上、productionでは必須とする。production以外の未設定時はprocess-local random keyを使うため、process restart後の既存cursorは失効する。secret rotationでも既存cursorが失効することを運用上のrollback/rotation契約とする。

saved viewはscalar filterをtyped column、label operator/descendant flagを正規化relationへcanonical IDだけで保存する。list/detail/executeはcurrent ACLを再評価し、hidden/deleted/revoked/absent/inactive-group参照を同じ`invalid_saved_view`へ畳み込む。通常list/detailがfilterを返せない場合でも、別のowner-only recovery metadata APIがlabel/filter内容を返さず`id|name|version|updatedAt`を提供する。update/deleteはowner + expectedVersionを要求するが、staleな旧refの可視性を要求しないため、ownerは全filter置換またはlogical deleteで回復できる。DELETE成功時は`204 No Content`とし、旧filterやcanonical label IDを応答へ戻さない。create/updateでは新filterのcanonical root visibility、current descendant展開、visible expanded ID上限をbusiness writeと同じSerializable transaction内で再確認し、競合はbounded retry後に一定のversion conflictへ正規化する。

saved-view mutationと監査は同じPrisma transactionでcommitする。共有`AuditLog`は`targetTable=knowledge_saved_views`、`targetId=saved_view`の一定markerと、schema/versionだけのallowlist metadataを使い、saved-view ID、name、label ID/name/alias、filter body、cursor、検索語を記録しない。

migrationは既存indexを保持したまま、KnowledgeItemへ`updatedAt,id`終端のvisibility/cursor indexを追加し、active assignmentへ`labelId,knowledgeItemId WHERE detachedAt IS NULL`のpartial indexを追加する。application rollbackではindex/tableを保持したまま旧imageへ戻し、migration逆適用やdata削除を行わない。

### 04. Snapshot / artifact / manual capture

- Depends on: 02、#1975 repository-side storage boundary
- 目的: immutable snapshot/version/hash、text/PDF/image/manual capture、既存 artifact port、認可 download を実装する。
- 非対象: SNS API巡回、実 Drive cutover、source delete。
- 受け入れ: size/type/timeout、SSRF/redirect/private IP/active content対策、caller側 bounded stream/content-type検証、owner-scoped Knowledge artifact wrapper、pending/ready/failed reconciliation、provider URL非公開、manual capture UI。
- rollback/test: fake/local storage、checksum/idempotency/partial failure、owner scope省略不能、owner跨ぎidempotency collision、download ACL、oversize/content-type拒否、sanitized UI evidence。実 credential は別証跡。

#### 04-A. Backend snapshot/storage contract（Issue #2012 PR A）

- `KnowledgeSnapshot`は`KnowledgeItem`配下のappend-only versionであり、`item + version`と`item + request-key hash`を一意にする。capture payload、SHA-256、size、content type、capture method、sanitized source URLをprovenanceとして保持し、既存versionを上書きしない。
- capture intentと必須auditをSerializable transactionで先に確定し、bounded captureとartifact storeはtransaction外で行う。materialized metadata記録前と`ready`確定transaction内でcurrent owner/active itemを再検査する。store前に失効したcaptureはartifactを作らずsanitized `failed`へ遷移して404を返し、store中に失効したcaptureはsource-delete禁止のためartifactを削除せず`pending`を残して404を返す。materialized metadataと`ready`確定はCAS更新し、外部createの結果が不明またはDB finalizationが失敗した場合も成功を返さず`pending`を残す。外部create前に確定できる設定・事前検証失敗はsanitized codeで`failed`へ遷移する。
- retry/reconcileは外部createを再実行しない。`context=knowledge`、provider、owner、opaque idempotency key、content type、SHA-256、sizeが一致する既存`ready` artifactをowner-scoped openしてbyte内容まで再検証した場合だけDBを`ready`へ確定する。共有artifact adapterも既存idempotency rowの全状態とunique-create/ready CAS競合でowner一致を必須とし、owner跨ぎの再利用を`artifact_idempotency_conflict`としてfail closedにする。
- Knowledge contextは専用portで共有artifact portを包み、`ownerType=knowledge_snapshot`と`ownerId=snapshotId`を呼出側から省略・変更できない。provider metadataへ渡すidempotency keyとstorage nameはSHA-256由来とし、生のuser/item/request keyやfilenameを使用しない。
- append/reconcileはitem ownerだけ、list/detail/downloadはcurrent item ACLとsnapshot relation/statusを再評価する。captureはartifact I/Oの前後、reconcile/downloadはprovider I/O直前・直後にもcurrent ACLとartifact metadataを再確認し、provider key、Drive URL、artifact ID、request hashをAPIへ返さない。この境界はrequest-time authorizationであり、HTTP response開始後のin-flight revokeを原子的に保証しない。
- download streamは全量をapplication heapへ保持せず、shared adapterの事前検証に加えてincremental size/hash guardを適用し、consumer終了・error時にunderlying provider/local streamを破棄する。owner-scope不一致は404、認可後のprovider/content/metadata障害はdetailを含まない502とする。
- URL captureは既存`safeFetch`のHTTP(S)、DNS/private IP、redirect制限を使い、caller側でも10秒のtotal timeout、`Content-Length`、実読込byte、allowlist content typeを検証する。超過、timeout、read error時はbody readerをcancelする。
- allowlistはUTF-8 plain text/HTML、PDF、PNG、JPEG、WebP、GIFとし、binaryはmagic byteを検査する。最大artifactは10 MiB、text/HTMLは1 MiB、抽出plain textは250,000 code pointとする。SVG等のactive content、invalid UTF-8、signature spoofはfail closedとする。
- raw HTMLはinline表示せず、downloadはattachment、`application/octet-stream`、`nosniff`、`no-store`、sandbox CSPで返す。検索/UI用representationはactive elementを除いたplain textへ分離する。
- providerは`KNOWLEDGE_SNAPSHOT_PROVIDER=local|gdrive`（既定`local`）。local pathは`KNOWLEDGE_STORAGE_DIR`、Google Drive folderは`KNOWLEDGE_GDRIVE_FOLDER_ID`とし、gdrive時は完全な共通`ERP4_GDRIVE_*` credential setを要求する。legacy Chat credentialへfallbackしない。
- application rollbackは新table/artifactを保持したまま旧imageへ戻し、migration逆適用、source delete、artifact delete、provider cutoverを行わない。PR Aのrepository-side fake/local検証を実Google Drive、Sakura VPSまたはproduction成功として扱わない。

manual capture UI、利用者向けpending/reconcile表示、frontend unit/E2E、sanitized screenshot evidenceはPR Bで実装し、PR Aは`Refs #2012`としてIssueをcloseしない。

### 05. Annotation / conversation import / synthesis

- Depends on: 02（binary attachment参照は04）
- 目的: annotation、conversation/turn、item relation、versioned synthesis/provenance を実装する。
- 非対象: external LLM runtime、自動 ChatGPT session取得。
- 受け入れ: role/source分離、複数item relation、Markdown/JSON/manual import、引用と本人/AI/外部情報のUI区別、idempotent import。
- rollback/test: parser bounds、malformed/oversize input、cross-owner relation拒否、version/history、sanitized fixtures/UI evidence。

#### 05-A. Backend provenance foundation（Issue #2013 PR A）

PR Aはimport parserとUIを有効化する前に、次のDB/application/API契約を固定する。

- annotation kindは`note|question|hypothesis|quote|todo`、originは
  `user|external|ai|system|tool`とする。本人だけが作成・改訂・logical deleteでき、改訂は
  immutable revisionを追加して旧本文を保持する。revision、turn、synthesis version/sourceは
  新規table専用DB triggerでもupdate/deleteを拒否する。
- conversation roleは`user|assistant|system|tool`、item relationは
  `primary|supporting|contradicting|context`とする。turnはappend-onlyで、sequenceと
  conversation versionを用いて同時追加を競合として返す。
- manual conversation/turn APIでは自由文字列のprovider、model、tool nameを受け付けず、
  responseも`null`へ固定する。import由来の公開label語彙はbounded parserと同時にPR Bで
  固定し、credential-like valueをDB/APIへ通さない。
- conversationへlinkできるitemは同一ownerに限定する。application検査に加え、relation内部の
  `ownerUserId`からconversationとitemの`(id, ownerUserId)`へ張る2本のdeferrable composite
  FKにより、直接insert、親owner更新、並行競合でもowner一致を保証する。read visibilityはlinked item
  ACLの共通部分とし、一件でも現在read不能ならconversation、turn、relation、件数を返さない。
- synthesisはstable identityとappend-only versionを分離し、version番号を集約内で一意に
  する。source relationは`primary|supporting|contradicting|context`で、item、snapshot、
  annotation/revision、conversation/turn、別synthesisの固定versionのいずれか一件を明示FK
  で参照する。exactly-oneとself-source拒否をDB constraintでも保証する。
- sourceは作成時とread時にcurrent ACLを再検査する。後からaccessが失効したsourceは本文、
  ID、actor、timestampを返さず、kind/relation/orderと`accessible=false`だけを返す。
- recursive source ACLはsynthesis-version edgeを一段として16段まで許可し、request-scoped
  memoizationとversion node 128、source edge 512、DB query 512のbudgetを適用する。cycle、
  source 0件のorganization synthesisはnon-ownerへfail closedとする。create/append内の全
  repository操作は同じaccess contextを共有し、ID指定read/mutationのbudget超過は存在しない
  IDと同じ`not_found`へ正規化する。
- Knowledge mutationとmandatory auditを同一transactionで確定する。audit metadataは
  allowlistとし、annotation/turn/synthesis本文、prompt、URL、provider key、raw error、
  request keyを保存しない。provenance mutationの認証scopeは検証済みrequest contextからだけ
  最大100件・各255文字で保持し、trim/deduplicateして共通の
  `A-Z a-z 0-9 . _ ~ : / -`語彙へ制限する。URI path形式を維持しつつ、Unicode制御・bidi文字、
  userinfo、query、fragmentを認証境界と監査境界の両方で拒否し、mandatory auditだけが正当な
  requestをrollbackする状態を防ぐ。JWT文字列はU+0020 SPだけ、設定値だけはcall siteで
  comma-separated listとして分解し、JWT内のTAB/LF/CR/FF/VTやカンマを権限scopeへ再解釈しない。
  scopeおよびprincipal/actor/request/token/audience/agent run識別子はraw値の制御・format・
  bidi文字、ill-formed UTF-16 surrogateと端部whitespaceをtrim前に拒否する。JWTとBFF OIDCの
  issuer/provider subjectもcanonical identity lookup前に同じ境界を適用し、不正な認証provenanceを
  別identityへalias化したり正規化後の値として監査へ残さない。既存契約どおり`act.sub`の正確な
  空文字だけは未指定相当とする。
  JWT `exp`は存在する場合に非負safe integerへ正規化できる有限numberだけを認証境界で受理し、
  上限超過や不正型をbusiness mutation／mandatory auditへ到達させない。
  `x-request-id`はFastify logger生成前かつtrim等の正規化前にraw値を安全文字・1〜128文字で検査し、不正値はraw値を保持せず
  random UUIDへ置換してresponse、log、mandatory auditへ同じ検証済みIDだけを渡す。
  request bodyやraw bearer tokenからscopeを受け付けない。DB CHECKでもaction groupとtarget
  tableを厳密に対応付ける。
- listはbounded limit、stable sort、actor/resource/parentへ束縛したHMAC署名付きopaque
  cursorを使用し、権限外rowをpage、cursor、countへ含めない。organization synthesisの
  candidate scanは200件、provenance queryは上記budgetで停止し、上限到達時はhidden rowを
  cursorへ含めず、hidden件数によってHTTP statusを変えない。確認済みvisible rowのみを返し、
  続きが安全に確定できない場合はnext cursorを返さない。query budget超過時は空pageとする。
  version historyのlookahead rowもcursor発行前にACLを検査する。
  履歴cursorのsequenceはPostgreSQL `INTEGER`最大値まで許可し、incrementを伴うmutationの
  `expectedVersion`上限とは分離する。
- annotation history/revise/deleteはannotation ownerだけでなくparent item ownerと
  `deletedAt IS NULL`も同じrepository predicateで再検査する。
- annotation/conversationの全readはRepeatable Read transactionで実行し、そのsnapshotを
  認可線形化点とする。annotation本文queryはparent item ACLを同じpredicateで再検査する。
  annotation historyとconversation turn listはparent visibilityの事前確認だけを本文返却の
  根拠にせず、revision/turnを読む子table query自体でも同じsnapshotのcurrent parent ACLを
  再検査する。snapshot後にgrantが失効しownerが履歴を追加しても、失効後の新規本文を同じ
  responseへ混在させない。source linkは同一transaction内でsource ACLを検査してからmutationと
  mandatory auditを確定する。失効がsnapshotより先にcommitした場合はfail closedとし、
  snapshotより後の失効は後続requestから反映する。進行中transactionを遡及取消しする契約や
  grant rowの長時間lockは導入しない。
- synthesisの複数source ACLはread/mutationとも同一Repeatable Read snapshotで評価する。
  再帰version memoは到達depthをkeyに含め、異なるdepthの結果を再利用しない。同一synthesisの
  現行・過去versionはapplication検査とDB constraint triggerの両方でsource指定を拒否する。
- APIはannotation list/create/detail/history/revise/delete、conversation
  list/create/detail/item add-remove/turn list-append、synthesis list/create/detail/version
  history-appendを提供する。unauthorized IDと存在しないIDは同じ`not_found`へ正規化する。

schema migrationはadditive/expand-onlyとし、既存table/column/dataを変更または削除しない。
履歴改変拒否triggerは今回追加する新規tableだけを対象にする。
旧applicationは新migration適用後もKnowledge CRUDとhealth/readinessを継続できることを
PostgreSQL 15で確認する。application rollbackでは新table/dataを保持する。

PR Bはmanual/JSON/限定Markdownのpreview/commit、parser bounds、idempotencyを追加する。
PR CはKnowledge Hub UI、real-backend E2E、manual、sanitized screenshot evidenceを追加し、
その時点でIssue #2013をcloseする。annotation/synthesis検索とconversation全文検索は現行
#2011の明示検索scopeを暗黙に拡張せず、別途API/query-cost/ACL契約を固定してから扱う。

#### 05-B. Bounded conversation import（Issue #2013 PR B）

PR Bのimport APIは`POST /knowledge/conversations/import/preview`と
`POST /knowledge/conversations/import/commit`の二段階とする。previewはDBへconversation、turn、
item relationを作成せず、canonical actor、linked item ACL、形式・上限を検査して10分間だけ
有効なopaque tokenを返す。commitは同じ入力とtokenを再検証し、利用者の明示操作としてだけ
mutationする。

- 対応形式は`manual`、strict `json`、限定`markdown`。全形式の入力本文をcanonicalな
  unpadded base64urlでtransportし、decode後にfatal UTF-8を適用する。ZIP/TAR、URL/network
  fetch、HTML実行、provider API、ChatGPT/Chatwork account archive、添付展開は扱わない。
- manualとJSONは同じstrict object grammarを使い、title、固定provider/model語彙、turn配列だけを
  受理する。JSONは`JSON.parse`前に線形走査し、depth 12、container node 5,000、duplicate key、
  `__proto__|prototype|constructor`を検査する。未知field、role、origin、provider/model/tool nameは
  推測変換せず拒否する。
- Markdownは`# Knowledge Conversation v1`、header metadata、`## Turn`、turn metadata、本文から
  なる限定文法だけを受理する。speakerを本文から推測せず、raw HTML、script、linkは実行・取得せず
  inert textとして保持する。
- 上限はraw/canonical各512 KiB、1 turn 64 KiB、turn 200件、linked item 20件、Markdown
  5,000行、metadata 1行1 KiB、title 500 code point、provider/model/tool nameとrequest key
  200 code pointとする。HTTP body limitは1 MiB、preview/commitは既定20 requests/1 minuteの
  専用rate limitを持つ。
- roleは`user|assistant|system|tool`、originは`user|external|ai|system|tool`を別fieldで保持し、
  固定した組合せだけを許す。公開providerは`openai|anthropic|google|microsoft|other`、modelは
  `gpt|claude|gemini|copilot|other`、tool nameは`search|browser|code|file|other`とする。
- canonical payload hashはformat、固定key順のnormalized payload、ordered turn、ordered item relation、
  canonical ownerを含み、server commit時刻は含めない。hash、raw input、item ID、request keyは
  response、audit、application logへ返さない。
- preview tokenは既存`KNOWLEDGE_CURSOR_SIGNING_SECRET`から用途別に導出したHMAC-SHA-256鍵を使い、
  purpose/version、actor fingerprint、format、keyed payload/item binding、issued/expiry、opaque operation
  IDだけを署名する。本文、raw hash、raw request key、item ID、provider keyはtoken envelopeへ入れない。
- commitはlinked item IDをsortして同一順序で`FOR UPDATE`し、owner一致・非削除を全件再検査する。
  preview後にACLが失効した場合とcross-owner/nonexistent itemは同じ`not_found`とし、item title、
  relation、件数を漏らさない。
- request ledgerはcanonical ownerとraw request keyのdomain-separated SHA-256だけを保存し、
  `(ownerUserId, requestKeyHash)`を一意にする。同じkey+payloadと同じpayload+別keyは既存conversationを
  返してturn/relationを増殖させない。同じkey+別payloadはsanitized 409とし、同時競合は
  Serializable transactionを最大3回だけ再評価して一件へ収束させる。clientはUUID v4相当または
  128 bit以上の予測困難なoperation keyを生成し、利用者入力や本文から導出しない。serverはC0/C1、
  Unicode `Bidi_Control`、BOM、ill-formed UTF-16 surrogate、端部whitespaceをhash前に拒否する。
- ledger、conversation、turn、relation、mandatory auditは同じtransactionで確定する。auditには
  format、turn/item件数、duplicate flag等のallowlistだけを保存し、本文、hash、request key、item ID、
  parser stackを入れない。ledgerはowner複合FKとDB CHECKを持ち、update/deleteをtriggerで拒否する。
- migrationはledger table/index/FK/CHECK、import識別子があるconversationのprovider/model列、
  新規turnのname列への`NOT VALID` CHECKだけを追加するexpand-only変更とする。migration前の
  非import conversationに未対応provider/model値があっても、値を保持・redactしたまま親rowの
  version/content hashを更新できなければならない。rollbackは新tableとimport済みdataを保持したまま
  PR A application imageへ戻す。PR A applicationでimport済みconversation/turnを読めること、未知だった
  公開labelを`null`へredactすること、migration前の未対応label rowを新旧applicationで更新できること、
  既存Knowledge CRUD/health/readinessが継続することをPostgreSQL 15で検証する。

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
- application rollbackを維持するため、初期段階では`ChatMessageType=text`を維持し、
  fixed generic fallbackと一対一share relationをcard discriminatorにする。selected contentを
  `ChatMessage.body`、notification、search、auditへ複製しない。
- share snapshotはtitle/source type/safe canonical URL/ready snapshot version+hashとbounded excerpt/
  active label assignment/exact annotation revision/exact conversation turn/exact synthesis version/
  bounded sharer noteのtyped rowだけを許可する。非選択field用の汎用JSON metadataを正本にしない。
- previewはmutationなし、commitは`confirmed=true`を必須とし、sourceとroom ACLおよびexact versionを
  再検査する。raw request keyは保存せずactor-scoped hashを使い、same key+same payloadは既存share、
  same key+different payloadはmutationなしのsanitized conflictとする。
- same key+same payloadの既存結果回収は、署名済みpreviewのactor/source/room/payload bindingを
  再検証した上でtoken expiryや後続のsource削除/ACL失効後も許可する。新規mutationはこの経路を
  使用できず、期限、current ACL、exact source versionの検査を必須とする。
- share post結果不明時は`pending`を保持し、read-only reconcileで既存referenceだけを照合する。
  failed/revoked shareを自動再投稿しない。revokeはcontent-free placeholderを返し、threadを物理削除しない。
- Knowledge actorのcanonical `UserAccount.id`と既存Chat identityを分離して同じ認証要求から
  server-sideに解決し、share rowの`chatPosterUserId`、固定fallback本文、active rootをDB制約で
  検証する。source ownerまたはsharerだけがrevokeでき、outsiderには存在を返さない。
- project destinationでは既存Chat room policyのcanonical project claimを維持し、そのpolicyを
  preview/commit transactionで再評価する。加えてactive `Project` rowを再照会・lockし、削除済み
  projectのroom aliasを認可根拠にしない。`ProjectMember` rowを新しい必須条件として追加しない。
- preview audit target、signed preview token、commit aggregateは同じ予約share IDへ相関させる。
  同じpreviewを別request keyへ再束縛する操作はsanitized conflictとし、Chat rootを作成しない。
- 投稿確定後のnotification/Web Push/emailには固定fallbackだけを渡し、選択内容やprovider URLを
  複製しない。official room/viewer groupを既存Chat audience契約どおり対象にし、share notificationの
  並行実行/retryはopaque unique dedupe keyで一件へ収束させる。通知失敗はsanitized logへ記録するが、
  確定済みmessage/shareを失敗へ戻さない。
- provider hostの末尾ドットによるdeny-list迂回を拒否する。posted/revoked shareのgeneric Chat rootは
  DB triggerとChat削除serviceの両方で逆方向の本文/投稿者/room/thread/deleted state変更および物理削除を
  禁止し、表示停止は明示的なshare revokeだけで行う。pending→posted bindingはChat rootを
  `FOR UPDATE`で直列化し、reconcileと本文変更/logical deleteの競合はposted+invalid rootへ収束させない。
- strict旧clientとの互換のため既存Chat timeline/thread response shapeは変更しない。card-aware clientは
  timelineで実際に受信した1〜100件のmessage IDを
  `GET /chat-rooms/{roomId}/knowledge-share-messages?messageIds=...`へ渡し、そのexact集合に対応する
  message ID、share ID、posted/revoked、optimistic version、schema versionだけを固定本数batchで取得する。
  message IDは最大200 Unicode code point/800 UTF-8 byteとし、controlおよびbidi-directional code pointを
  拒否する。
  別時点のtimeline条件を再評価しないため、並行投稿によるpage driftを起こさない。通常text message、
  search、notification、unread、ACKは従来のgeneric本文契約を維持する。roomがexternal-enabledへ
  変化した場合はcompact discriminatorも404とし、shareの存在とstable share IDを公開しない。
- full cardは`GET /chat-messages/{messageId}/knowledge-share`で単体取得する。active root、current room
  read ACL、active project、share statusを同一consistent snapshotで再検査し、
  postedのみselected typed snapshot、revokedはcontent-free placeholder、pending/failed/non-share/
  unauthorized/missingは同じ404とする。roomがexternal-enabledへ変わった場合は本文を返さない。
- room-only viewerにはselected snapshotを返してもsource内部IDを返さない。source-openはshareが現在も
  未削除のChat rootへbindされていることを同じsnapshotで再検査し、`canOpenSource`はcurrent Knowledge
  ACLを独立再検査する。source削除/ACL失効後はfalseとする。canonical URLは保存値を信頼せず
  response時にもcredential/query/fragment/provider hostを再sanitizeする。
- thread promote は posted かつ未revokeのKnowledge share rootに限定し、1〜100件のactive direct replyを
  利用者が順序付きで明示選択する。rootの汎用fallback、thread全文、未選択reply、notification/search
  snippetはpromotion snapshotへ複製しない。MVPは新規`KnowledgeSynthesis` version 1の作成だけを扱い、
  既存synthesisへのappend、自動要約、AI実行を行わない。
- `POST /chat-messages/{rootMessageId}/promote-to-knowledge/preview`はcurrent room read ACL、active project、
  exact share version/hash、replyのroom/root/deleted state/body hash/activity boundary、destination scope/grantを
  consistent snapshotで検査し、選択本文、選択/省略件数、destination、synthesis入力のexact previewだけを
  返す。10分の用途分離HMAC tokenにはactor/root/payloadのfingerprintだけを格納し、本文、message ID、
  room ID、request keyを平文で入れない。
- commitは`confirmed=true`を必須とし、previewと同じ境界を再検査する。personalを既定とし、organizationは
  actorのcurrent organizationと1件以上のactive group grantを明示要求する。room accessをKnowledge write
  ACLへ昇格させない。同じopaque request keyと同じpayloadは同じpromotion/synthesisへ収束し、異なる
  payloadはmutationなしのsanitized 409、Serializable競合は最大3 attemptとする。
- 選択replyは`KnowledgeThreadPromotionMessage`へimmutable copyとして保存し、順序、本文hash、作成時刻、
  activity boundary、sanitized author categoryを固定する。`KnowledgeSynthesisSource`はpromotion FKを
  exactly-one source制約へ追加し、自由文字列source type/idを正本にしない。後からChat ACLまたはshare
  状態が失効してもsynthesis本文はdestination ACLで保持するが、live thread identityはredactする。
  現行MVPのChat text replyは内部user categoryだけを受け入れる。external-enabled share roomはfail closed、
  system/tool message typeは非対象とし、識別可能なsource discriminatorなしにcategoryを推測しない。
- organization promotionで作成するsynthesisは明示`KnowledgeSynthesisGroupGrant`を持つ。migration前の
  organization synthesisはgrant row 0件の既存organization-wide契約を維持し、new promotionだけを
  grant必須にするexpand段階とする。

### 08. External LLM common boundary / AI dialogue / cost guard

- Depends on: 04、05。手動 import/stub MVP が先
- 目的: provider port、selected-context prompt、監査、rate、timeout、token/cost reservation/limit を実装する。
- 非対象: autonomous sharing、unbounded batch、ChatGPT cookie、production key。
- 受け入れ: default disabled、preview/confirm、allowlist、minimal send、provider/model/usage/cost provenance、hard stop、結果/usage不明時のreservation保留と自動再送禁止、no fallback。
- rollback/test: stub/fake provider、timeout/quota/malformed response、budget race、usage不明reconciliation、redaction、secret scan。実 provider evidence は別承認。

#### provider/budget foundation contract

- read-only budget previewはreservation時のauthoritative判定と同じsubject境界を使用する。active policy IDだけのcounterを表示せず、personalではuser、organizationではuserとorganizationについて、current monthly windowと重なるinactive policy versionのperiod counterおよび直近60分のreservationをsubject単位で集計する。policy、period、rolling usageは同一`RepeatableRead` snapshotで読み、soft limit、hard limit、rate limitを同じ定義で警告・停止する。request-specific previewではcatalogから確定したcurrencyも入力へ束縛し、active policyとの不一致をcommit前にfail closedとする。current window内のhistorical periodでcurrencyまたはtimezoneがactive policyと一致しない場合も、利用可能と誤表示しない。

- host allowlistはraw入力をUnicode case fold前にprintable ASCII検証し、IPv6 literalはURL側の角括弧を除いたcanonical表現で比較する。
- actual input usageは予約済みconservative input estimate、actual output usageは要求したmax outputを超えてはならない。超過usageは`usage_invalid + held_maximum`として通常settlementしない。hard-limit残高へ戻した累積release counterは`NUMERIC(38,0)`のinteger micro-unitで保持する。

- Knowledge use caseはChat summary関数を直接呼ばず、provider-neutral text portを経由する。共有infrastructureは同期的かつprovider I/Oを行わない`bind`、provider I/Oなしの`prepare`、単一使用の`dispatch`を分離し、prepareでrequest serialization、scheme/host、DNS解決、private-address判定、address pin、body変換を完了する。pre-dispatch検証には独立した有限timeoutを適用し、provider network timeoutはDB intent確定後の`dispatch()`開始時から全量を計測する。Knowledge orchestratorはadapterが生成したrequest fingerprintをrunのimmutable `providerRequestHash`として予約時に保存し、prepared fingerprintとの一致を確認してdispatch intentとmandatory auditをtransaction確定した後にだけ同じprepared requestをdispatchする。fingerprintは未対応surrogateを拒否したversion付きcanonical provider bodyの実UTF-8 bytesに加え、canonical final endpoint、host allowlist、HTTP/private-IP許可、timeout、response byte上限、malformed-success／usage policyへ束縛する。DBとauditへ保存するのはopaque SHA-256だけであり、raw endpoint、allowlist、credentialを保存しない。selected contextはsourceごとに独立したmessage elementへserializeして本文中の`[C<n>]`／`[U]`文字列で境界が衝突しないようにする。context未指定のChatは従来のsystem/user二message payloadを維持する。prepare後のcaller object変更でpayloadを変化させない。dispatch後のtimeout・socket errorはrelease可能なpre-dispatch failureへ戻さない。共有infrastructureはsafe HTTP、timeout、bounded response、redaction、provider error分類だけを担当し、Chat prompt、Knowledge ACL、予算、retry判断を所有しない。providerの4xx/5xx本文はpromptやcredentialを反射し得るため保存・log・errorへ連結せず破棄し、statusと固定failure codeだけを返す。成功header後のbody timeoutも`timeout_outcome_unknown`、DNS／scheme／host／non-public-address guard failureは`rejected_before_dispatch`へ正規化し、空の成功本文をKnowledgeの通常成功にしない。`allowPrivateIp=false`ではIANA IPv4/IPv6 Special-Purpose Address Registry（実装基準日2025-10-09）のうちglobally reachableでない範囲、IPv4-mapped、link/site local、unique local、multicast等をliteralとDNS結果の双方で拒否する。registry更新時は一覧とnegative fixtureを同時更新する。private IP明示許可時も接続前DNS解決とpinを行い、Node lookupのfamily/all契約を保持する。valid contentとusage accountingは別々に正規化し、usage欠落または不正usageでも本文を失わず`missing|invalid`を明示してKnowledge側のusage-unknown保持へ渡す。provider固有の非課金保証がない4xxはreleaseせずmaximumを保持する。既存`CHAT_EXTERNAL_LLM_*`のkey、既定endpoint、prompt、request body、response contractは後方互換で維持するが、hostはセキュリティ境界としてraw ASCIIを必須とし、従来WHATWG変換で受理され得たUnicode／IDN表記はASCII punycodeへの明示移行を要求する。
- Knowledge providerは既定`disabled`で、`CHAT_EXTERNAL_LLM_*`へfallbackしない。任意provider/model入力は受けず、version付きcatalogのenabled entryだけを使用する。model identityは前後のECMAScript TrimString文字、C0/C1 control、Unicode 15.0 `General_Category=Format (Cf)`、ill-formed surrogateをapplication／DB／mandatory auditの共通契約で拒否し、1〜200 Unicode code pointsに限定する。価格・currency・catalog versionは利用者入力を正本にせず、use caseが有効なcatalog snapshotから解決してbudget port入力を再構築する。価格はfloatではなくISO currencyごとのinteger micro-unit/100万tokenとし、各項を切り上げて最大reservationを計算する。
- personal runはuser policy、organization runはuserとorganization policyの両方を必要とする。policyは明示IANA timezone、soft/hard月次上限、requests/hour、currency、versionを保持する。policy subject、run actor、organization、created/updated actorは共通auth identifier契約でcanonical性をapplicationとDBの両方で検証し、Unicode control／format文字や前後空白を含む別表現を拒否する。timezoneは前後空白なしのIANA名であることをDBでも検証する。予算月・rolling rate・reservation/dispatch/settlement/reconcile時刻はrequest入力ではなくserver側clock dependencyから一度だけ取得し、process timezoneやclient timestampへfallbackしない。異なるcurrencyのpolicyを混在させない。
- hard判定は`settled actual + active reservation + held maximum + new maximum`で行う。active policyは`active=true`の選択とrow lockを同一SQL statementで行い、同時version切替はSerializable transactionを最大3 attemptだけ再評価する。active policyの上限を適用しつつ、同じsubjectの当月消費とrolling 60-minute request数はinactiveな旧policy versionのreservationも含める。現在の月次windowと重なる旧periodのcurrencyまたはtimezoneがactive policyと異なる場合は、月境界を再解釈せず`policy_mismatch`でfail closedとする。rolling 60-minute窓だけに残る終了済みperiodはrate countとlockには含めるが、current-window drift判定には含めない。current period境界不整合や無効timezoneはtransactionをrollbackし、本文なしの`knowledge_llm_budget_blocked` auditとsanitized `policy_mismatch`へ正規化する。月初ローカル時刻がoffset後退で曖昧な場合はPostgreSQLとapplicationで後側UTC instantをcanonicalとし、alternate instantを拒否する。policyを決定順にlockした後、active policy lock下でcurrent periodを発見し、不足periodだけを作成する。この段階では既存periodをlockせず、続けて全subjectのcurrent periodとrolling 60-minute窓に重なるhistorical periodのunionを単一SQLで取得し、settlementと同じglobal period ID順で一度だけlockする。subject別usageを読む前に、lock済み集合内のcurrent period境界／timezone／currencyを再検査する。periodのpolicy metadata／境界はinsert時に固定する。counter-only period updateではpolicyを再lockせず、reservationとsettlementのlock順を循環させない。reservation INSERTは親runの初期`reserved`状態、actor／organization subject、period、currency、最大額、作成時刻をDB triggerで検証する。budget/rate accounting用の`accountedAt`はcaller値を使わずPostgreSQLのUTC clockで上書きし、そのinstantを含むcurrent periodだけを許可する。triggerはrunに必要なuser／organization全subjectのactive policyを共通順序で、current-windowとrolling 60-minute窓のperiod unionをglobal ID順でlockしてinactive versionおよび月初直後の前月periodを含むhard limit、soft warning、rolling 60-minute rateを再検査してから、同じstatement/transactionでperiodのactive counterとrequest countを加算する。これによりDB直接writerでも過去period／backdated `createdAt`によるbudget/rate迂回を認めない。organization runのuser/org reservationを逆順で挿入するdirect writerも、最初のrowで全required subjectをlockするためcross-subject deadlockを作らない。applicationが選択したperiodとlock後のDB accounting instantが月次境界でずれた場合は、run／period mutationをrollbackし、DB constraint diagnosticを本文なしのmandatory auditとsanitized `policy_mismatch`へ正規化して再previewを要求する。dispatch後またはterminal runへの遅延insert、同一subjectの二重reservationを拒否する。同じopaque request hashは一つのrun/reservationへ収束するが、effective input estimate、凍結単価、currency、maximum reservationのいずれかが異なる再送は同じpayloadとみなさずidempotency conflictとする。hard/rate blockではprovider requestを作らない。soft-limit warningはrunへ固定し、同じrequestの再取得でも初回と同じwarningを返す。
- conservative input estimateは実際にdispatchするsystem prompt、16 KiB上限を独立適用したraw user prompt、exact selected context representationsのUTF-8 byte数をuse case内で`bytes * 2`として導出し、選択sourceごとに16 token、provider role/message framingに64 tokenを安全側固定overheadとして加える。contextは一source 64 KiB・合計256 KiBを別々に検証する。callerはcontext fingerprint、representation hash、byte/token countを別々に指定できず、typed source ID/version/hashとexact representationの単一ordered structureから全てを導出する。caller指定値で導出値を減らせず、安全側の追加floorだけを許すprovider tokenizer非同一のreservation estimateとする。use caseはprompt/context/model/scope/max outputに加え、effective input estimate、catalogのinput/output単価、currency、maximum reservationからdomain-separated request payload hashを、exact provider bodyからprovider request hashを再計算し、caller指定hashを正本にしない。PR Aはcaller supplied preview hashを確認済みの証拠として受け付けず、PR Bのpreview verifierが同じcanonical provider request hashと経済条件へ署名tokenを束縛・照合してからreserveする。run INSERTではDB CHECKも凍結input/output token上限と単価から各項切り上げ式でmaximum reservationを再計算し、DB-side writerによる過少予約を拒否する。dispatch時にDBがsourceごとのbyte数とestimate、source種別別件数、合計256 KiB、関連item 10件、provenance depth 1、固定provider framingを再検証し、runのinput estimateを超える集合を拒否する。runはcatalog versionに加えてinput/output単価をimmutable snapshotとして保持し、実usageはprovider outcomeとassistant/AI turnへ束縛してsettlement時にstrictに再検証する。costはcaller入力を信用せず、snapshot単価から各項を`ceil(tokens * price / 1,000,000)`で再計算する。
- mandatory LLM auditのactor正本は`AuditLog.userId`のcanonical actorとする。audit writerは共通auth identifier契約を再検証し、非canonical actorではDB mutationをcommitしない。operator billingのowner/operator比較もcanonical IDだけで行い、raw別表現によるself-settlement迂回をapplication／DBの両方で拒否する。LLM固有metadataへcaller supplied principal／delegated actor／scope IDを複製せず、request correlationと`api|agent`区分だけをallowlistする。
- selected contextの上限は、全source 32、snapshot 4、annotation revision 10、conversation turn 20、synthesis version 5、thread promotion message 20、関連item 10、一source 64 KiB、合計256 KiB、利用者prompt 16 KiB、固定system prompt 8 KiB、output 4,096 token、provenance depth 1とする。preview tokenは4 KiB、TTLは10分とし、catalogのmodel上限がこれより小さい場合は小さい方を適用する。
- Knowledge Hubのsource pickerはcurrent itemに関連し、current ACLとrun scopeを満たすexact sourceをserver-side paginationで列挙する。候補一覧を選択上限32件で切り捨てず、snapshot、annotation revision、user/assistant conversation turn、synthesis version、thread promotion messageを全て扱う。system/tool turnおよび再帰的LLM/synthesis/promotion provenanceは候補API段階で除外し、preview/commitでも同じresolverを再評価する。候補cursorはactor、item、source種別、sort boundaryへ束縛したAES-256-GCM authenticated-encrypted tokenとし、query URLを記録するrequest logからsource internal IDをbase64url decodeできない形にする。他の既存Knowledge provenance cursorの署名契約は変更しない。
- runはexecution（reserved/dispatched/result_ready/failed/result_unknown）とsettlement（reserved/settled_actual/released/held_maximum）を分離する。timeout、connection outcome unknown、finalization不明はreconcile可能な`result_unknown + held_maximum`だけを許し、通常`failed`へ入れない。usage不明はassistant resultを保持した`result_ready + held_maximum`とし、自動retry/provider fallbackを行わない。
- provider outcomeのcaptureは親runがdispatch済みで、`capturedAt >= dispatchedAt`の場合だけ許可する。capture時とfinalize時にDBがnormalized contentからconversation-turn用domain-separated SHA-256を再計算し、caller指定hashと一致しない証跡を拒否する。settlement/reconcileでは保存済みturnの`contentHash`だけを信用せず、実際のturn本文から同じhashを再計算する。`result_ready + held_maximum`はfinalized `usage_unknown` outcomeのfailure code／content hashとassistant/AI turnが一致する場合だけ許可する。
- dispatch遷移はtyped `knowledge_llm_dispatched` auditと同じtransactionで確定する。dispatch timestampは`reserved -> dispatched`で一度だけ設定し、中間・terminal遷移を含め以後変更できない。context sourceはrun/request/reservation/mandatory auditと同じ予約transactionで全件保存し、dispatch前だけ追加できる。ordinal 0から隙間なく並ぶ集合をrun lock下で確定した後はinsert/update/deleteできない。dispatch guardはtyped FK先のexact version/hashと本文representation hashを再計算し、source IDを含むorder-sensitive opaque fingerprintとの一致を要求する。terminal settlementはtyped `knowledge_llm_completed|failed|result_unknown|usage_unknown|reconciled` auditと同じtransactionで確定し、audit failure時はrun、reservation、period counterをrollbackする。reservation状態変更は先に検証済みterminal runへ束縛し、DB triggerがperiod counterをreservation ledgerからO(1)の差分更新で反映する。runとreservationのdeferrable整合性checkは部分的なterminal更新をcommitさせず、period counterの直接更新はtriggerで拒否する。各mutationで月内ledger全体を再集計せず、全件照合はread-only `erp4_knowledge_llm_assert_period_accounting(period_id)`をoperatorがoffline実行する。policy欠落／currency mismatch／Serializable retry exhaustionも本文なしのtyped budget-blocked auditを残す。audit metadataはallowlistされたprovider/model/token/cost/failure codeだけで、prompt、result本文、source ID、request key、provider raw errorを含めない。
- `result_unknown + held_maximum`からのreconcileは、許可された全failure code（timeout、connection outcome unknown、DB finalization failure）について、同一runに一度captureされ、immutableなupdate遷移でfinalizeされたvalid normalized outcomeがusage、content hash、assistant/AI turnと一致する場合だけ`result_ready + settled_actual`へ進める。outcome finalizeとsettlement/reconcileは常にoutcome row→run row→reservation→periodの順でlockし、逆順lockによるdeadlockを避ける。`result_ready + held_maximum + usage_missing|usage_invalid`はprovider outcomeを改変せず、exact assistant turnへ束縛されたimmutableなoperator billing evidence、run ownerと分離したauthenticated operatorのevidence createdBy／AuditLog.userId、snapshot単価による再計算cost、同一transactionのmandatory auditが揃った場合だけ`settled_actual`へ一方向精算する。DB triggerとapplicationの双方がrun owner自身によるself-settlementを拒否し、監査では`knowledge_billing_operator` role、operator専用reason code、allowlisted intervention分類で通常利用者のreconcileと区別する。同一evidenceの再照合は同じoperatorに限りidempotent、異なるoperatorまたは異なるevidenceはconflictとし、証跡のupdate/deleteを拒否する。finalized outcomeの直接INSERT、provider再送、証跡なしreleaseは行わない。request/context/reservation row、policy version、terminal outcomeとterminal runのdispatch timestampはDB triggerで不変とする。conversation referenceはresult_ready遷移でだけ設定でき、reserved/dispatched/failed/result_unknownではnullを維持する。reservationのDELETEによるperiod counter・rate accounting消失も拒否する。
- PR Aの`operator_billing` evidenceは公開APIではなくtrusted billing operations専用の内部境界とする。application／DBが保証するのはrun ownerと分離したoperator帰属、evidence不変性、状態・provenance・cost算術整合、証跡なしrelease拒否までであり、外部billing artifactの真正性を暗号学的またはprovider照会で検証するものではない。artifact verifier、operator authorization、監査済み入力経路が同時に実装されるまでroute／一般operator toolへ接続してはならず、安全なprovider lookupも検証済みartifactもない場合は`held_maximum`を維持する。
- migrationは新enum/table/index/FK/CHECK/immutable・state-transition triggerだけのexpand-onlyとし、既存rowを更新しない。application rollbackでは新tableを保持し、Knowledge endpoint/UIを無効化して旧imageへ戻す。

#### selected-context preview / explicit execution contract

- `GET /knowledge/llm/catalog`、`GET /knowledge/llm/budget`、`POST /knowledge/llm/runs/preview`、`POST /knowledge/llm/runs`、`GET /knowledge/llm/runs/{runId}`、`POST /knowledge/llm/runs/{runId}/reconcile`をallowlist responseで提供する。`stub`は明示設定されたtest/development構成だけで有効とし、`openai`も専用credential、HTTPS、host allowlist、private IP拒否を満たす明示設定時だけ同じprovider-neutral実行経路へ接続する。既定disabled時はcatalogを無効として返し、preview、budget、commitはprovider requestやbudget mutationを行わず拒否する。
- 選択可能sourceはexactなsnapshot、annotation revision、conversation turn、synthesis version、thread-promotion messageとする。synthesis versionはcurrent versionだけへ暗黙追従せず、利用者が選択した履歴versionもexact version/hashで固定できるが、non-ownerではその選択versionの全direct provenance sourceを現在readできることを候補、preview、commit、detail、結果conversationで再検査する。各sourceのcurrent ACL、scope、logical deletion、version/hashをpreview、commit、detailで同一read snapshot上から再検査する。reconcileはprovider disableやsource ACL失効後もrun ownerに対するlocal accounting遷移だけを完了し、その後のresponse取得はcurrent source ACLでfail closedとする。これにより本文を開示せずstale reservationをreleaseまたはheld maximumへ収束できる。personal sourceはowner本人だけ、organization sourceは同一organizationの有効group grantを含む通常read ACLを満たすactorだけが選択できる。conversation turnは`user|assistant`だけをMVPで外部送信可能とし、`system|tool`は明示的な後続契約なしに選択できない。LLM結果conversationを次のLLM contextとして再選択せず、provenance depth 1を維持する。synthesis provenanceはdepth 1、全source 32、関連item 10、一source 64 KiB、合計256 KiB、利用者prompt 16 KiB、output 4,096 token、永続化するresult 256 KiBを上限とする。
- previewはprovider call、run作成、budget reservationを行わず、mandatoryな本文非含有preview auditだけを記録する。responseは選択sourceのexact authorized preview、種別別件数、byte/token見積、maximum integer cost、budget warningと10分有効・最大4 KiBのHMAC tokenに限定する。tokenはcanonical actor、scope、provider/model/catalog、prompt template、prompt hash、ordered source type/opaque ID fingerprint/exact version/hash、max output、provider request hash、maximum reservation、purposeへ束縛し、本文、raw source ID、request key、credentialを含めない。commitは`confirmed=true`とowner-scoped opaque request-key hashを必須とする。
- commitはsame-key replayをreservation前に照合し、same key/same payloadは既存runを返し、異なるpayloadはsanitized conflictとする。fresh commitではsource再解決後にreservationを確保し、Serializable transaction内でsourceを再検査してdispatch intentとmandatory auditを確定してから、prepared requestを一度だけdispatchする。reported usageを伴うstub結果は、同一ownerのmanual `KnowledgeConversation`にuser turnとassistant/AI turnを作成し、outcome、actual settlement、runとのprovenanceを同一transactionで確定する。
- dispatch後のtimeout、connection outcome unknown、finalization failureは`result_unknown + held_maximum`とし、assistant turnを作成しない。valid resultとusage missing/invalidは本文をassistant/AI turnへ確定し、`result_ready + held_maximum`として通常successと区別する。reconcileはprovider requestを再送せず、provider runtimeのenablementに依存しない。provider network timeout上限120秒を超える150秒のgrace後に未dispatch reservationだけをreleaseし、dispatch済みで保存済みoutcomeがないrunはunknown/heldのまま確定する。grace中のdispatchはreconcileしても状態を変えず、in-flight provider結果をcapture不能にしない。source ACL失効時もaccounting遷移は完了するが、run/conversation本文はcurrent source ACLを満たさない限り返さない。LLM結果conversationのgeneric list/detailも全run context sourceのcurrent ACL共通部分をDB queryで評価し、grant失効やsource logical delete後は非表示とする。
- OpenAI-compatible transportはChat Completions互換の単一dispatchだけを使用し、Knowledgeでは256 KiBのstrict UTF-8/JSON/result上限、strict usage、HTTPS・host allowlist・private IP拒否を適用する。Chatの既存summary wrapperは従来の`CHAT_EXTERNAL_LLM_*`、1 MiB上限、malformed successful responseのempty fallback、usage無視を維持する。provider responseを得た後は、normalized outcomeを独立transactionで一度だけcaptureし、予約時に保存した最大16 KiBのprompt snapshotとともに共通finalizerでconversation/turn、settlement、mandatory auditへ確定して両本文をstaging rowから消去する。capture commitまたはDB finalizationの結果が不明な場合は再dispatchせず、保存済みoutcomeのexact status/hash/usageだけをreadbackしてreconcileする。provider側に安全なoutcome lookupがないため、保存済みoutcomeがなければ`result_unknown + held_maximum`を維持する。known 4xx/5xx/malformed/oversize/emptyは本文を保存せず`failed + held_maximum`、valid resultでusage missing/invalidは`result_ready + held_maximum`へ確定する。
- preview、reserve、dispatch、complete、unknown、duplicate、reconcileのmandatory audit metadataはprovider/model、source種別別件数、token/cost、status codeだけをallowlistし、prompt、result、source/conversation ID、preview token、request key、provider raw errorを保存しない。application rollbackでは新routeを無効化して新table/run/conversation provenanceを保持する。
- Knowledge Hub UIはcatalogを最初に取得し、providerが`disabled`の場合はbudget/source APIを呼ばず、送信操作を表示しない。enabled時もready snapshotの最新versionだけを既定選択とし、annotation revision、user/assistant conversation turn、synthesis versionは利用者が明示選択する。`system|tool` turnはMVPでは候補API段階で除外し、UIにも表示しない。previewはexact本文、選択／省略件数、推定token、最大予約額、soft/hard/rate状態を表示し、confirm後のcommitは一回だけ送信する。
- preview tokenとopaque request keyはcomponent memoryだけに保持し、localStorage、URL、画面、監査、logへ出さない。commit前またはterminal runの表示中のitem/tab切替またはunmountではpreview、token、key、provider結果を破棄し、dispatch中、送信段階不明、またはrunが`reserved|dispatched`の間は親workspaceまでitem/tab切替を抑止する。commit応答がnetwork error、invalid response、`execution_failed`、403／404等で送信段階不明になった場合はpreview由来run IDと同じrequest keyを保持し、run readが一時404または非terminal状態を返しても新しいpreview／request keyを作成可能な状態へ戻さない。同じrun IDのreadだけを再試行し、`result_ready|failed|result_unknown`へ到達した場合だけlockを解除する。preview token不正／期限切れ、stale preview、hard／rate／policy block、idempotency／reservation conflict、明示的なprovider送信前拒否など、server error codeが未送信を保証する場合だけlockを解除して新しいpreviewを許可し、HTTP statusだけではdispatch確定性を判定しない。terminal runが一度確定した後の404はACL失効としてsensitive stateをpurgeする。readはAbortSignalとgeneration guardでstale応答を破棄する。`result_ready + settled_actual`、`result_ready + held_maximum`、`result_unknown + held_maximum`を別表示し、usage/result不明では自動retry／fallbackを提供しない。reconcileは保存済み証跡だけを照合するread-only操作として表示する。

### 09. Chrome/Edge capture extension / PWA share target

- Depends on: 04
- 目的: 利用者が表示中の URL/選択範囲/metadata を inbox へ短い操作で送る。
- 非対象: authenticated page server scraping、SNS API monitoring、browser credential取得。
- 受け入れ: origin/permission最小化、user gesture、scope preview、idempotency、offline/duplicate/error UX、extension/PWA threat model。
- rollback/test: permission manifest review、malicious page payload、size/encoding、CSRF/session、browser compatibility、manual evidence。

#### capture ingress foundation

- PWA share targetとbrowser extensionはKnowledge mutationを直接呼ばず、`schemaVersion=1`のcapture draftを認証済みKnowledge Hubへ渡す。landing UIは受信だけでは保存せず、selected field、omitted field、destination scope、source typeのpreviewと明示confirmを必須とする。既定scopeは`personal`であり、`organization`はcurrent actorのorganizationと有効groupを再検査し、別のaudience確認を要求する。
- draft channelは`pwa_share_target|browser_extension`、field allowlistは`title|url|selectedText|description|author|publishedAt`に固定する。任意metadata、DOM/HTML、cookie、storage、form value、script/style、provider metadataを取り込まない。URLはcredentialを含まないHTTP(S)だけを許可し、fetchしない。title/authorは500 code point、URLは4,096 UTF-8 bytes、selected textは64 KiB、descriptionは16 KiB、publishedAtは200 bytes、canonical draftは128 KiBを上限とする。JSON escapeを含むHTTP envelopeは288 KiBで先にboundedし、decode後のcanonical 128 KiB上限と混同しない。不正UTF-8、NUL、C0/C1 control、Unicode `Bidi_Control`、ill-formed Unicode、nested object、prototype keyを拒否する。保存しないunknown scalarもdrop前にkey/valueのUnicode安全性を検証する。capture routeはFastify既定JSON decoderへ依存せず、encapsulatedなfatal UTF-8 parserでraw HTTP bodyを検査してからJSON schema／application normalizationへ渡す。
- preview tokenは既存Knowledge signing secretからdomain-separated keyを導出し、canonical actor、channel/capturedAt、exact selected field/payload、scope/organization/group、source type、opaque request keyのsecret-derived fingerprint、purpose、10分expiryへ束縛する。本文、raw request key、source IDをtokenへ入れない。同じpreviewを別request keyへ再束縛できない。previewはbusiness mutationを行わないが、本文非含有mandatory auditを記録する。
- `KnowledgeCaptureRequest`はowner-scoped opaque request-key HMACとpayload bindingを保持し、KnowledgeItem、materialization metadataを含むversion 1 pending KnowledgeSnapshot、capture ledger、mandatory pending auditをSerializable transactionで一つのintentとして確定する。同じkey/payloadは同じitem/snapshotへ収束し、異なるpayloadはmutation前に409とする。ledger HMACはproduction必須の専用`KNOWLEDGE_CAPTURE_IDEMPOTENCY_SECRET`から用途分離し、preview/cursor署名鍵rotation後も同じhashを維持する。capture履歴保持中にこのledger鍵だけを差し替えてはならず、rotationにはkey-version付きの段階migrationを別途先行する。request keyはASCIIの英数字、`.`、`_`、`-`だけを許可し、200 code pointを上限とする。選択済みfieldだけを決定順plain-text snapshotへmaterializeし、非選択fieldはitem、snapshot、ledger、auditへ保存しない。
- artifact storeはDB transaction外で一回だけ実行する。organization intent作成時は選択した全groupのactive group、membership、canonical user rowを決定順で共有lockし、store直前とprovider I/O後の全return path、finalization transaction内でもcurrent owner、item logical-delete、organization、previewへ束縛した全groupのlive membership／grantを再検査する。reconcileもstate読取後とprovider I/O後に同じexact ACLを再検査する。確定的store failureは`failed`、store/finalization結果不明は`pending`とし、capture IDを返して自動再送しない。Serializable retry枯渇はraw DB errorや500へ展開せずsanitized 409へ正規化する。reconcileは署名済みpreview intentと同じrequest keyを再検証し、そのpreviewより前に同じledgerへ確定した実captureを解決できるが、owner-scoped既存artifactの照合とDB finalizationだけを行い、新しいitem、snapshot、artifactを作らない。commitでは期限切れpreviewを拒否する一方、既に存在するpending ledgerのread-only reconcileは改ざんされていないexpired tokenを同じactor／request key／exact payloadに対して検証し、新規storeなしで回復できる。履歴ledgerのidentity更新・物理削除とterminal stateからの再遷移をDB triggerで拒否する。
- commit/reconcile responseは実ledgerの`captureId`と、検証済みpreview intentの`requestCaptureId`を分離して返す。landing UIは両者を同一と仮定せず、responseの`requestCaptureId`が保持中previewと一致する場合だけ受理する。exact previewはbackendが正規化して署名した全selected fieldの値とomitted field名を表示し、organization audience確認前に非表示payloadを保存できないようにする。network failure、HTTP 5xx、2xx response normalization failure、またはintent作成後にも返り得る`not_found`は結果不明としてpreview由来capture IDと同じrequest keyにlockし、自動再送しない。`invalid_request|forbidden|idempotency_conflict|preview_token_invalid|preview_token_expired|capture_transaction_conflict_pre_dispatch`のようにserverがmutation前拒否を保証するallowlist codeだけを確定拒否として新previewへ戻す。HTTP statusだけでは結果確定性を判断しない。commit/reconcile開始時は最初の非同期I/Oより前に親lockを同期取得し、pending／result unknownの間はsnapshot reconcileとannotation／conversation／synthesis／share／LLMを含む他のKnowledge mutation、item／tab切替を親画面まで抑止する。別の外部処理がbusyを解放してもcapture lockを解除しない。duplicate candidateは同じowner／payloadだけで判定せず、logical deleteとorganization grant／membershipを含むcurrent item ACLを満たすcaptureだけを返し、権限失効済み履歴の存在／statusを開示しない。
- JWT BFF modeのpreview/commit/reconcileはsame-originまたは設定済みAPI originへのcredential付きmutationとしてCSRF double-submit tokenを必須とする。share target service workerとextensionはsession/cookie/tokenを読まず、ERP4 APIを直接呼ばない。
- application rollbackはcapture route/UIを無効化し旧imageへ戻す。expand-only table、item、snapshot、artifact、audit historyは保持し、table dropやsource削除をrollbackにしない。

#### PWA Web Share Target

- installed PWAはmanifestの`share_target`で、same-originの`POST /share-target`、`multipart/form-data`、`title|text|url`だけを宣言する。file parameterは宣言せず、file part、unknown/duplicate field、nested/arbitrary metadataを拒否する。共有元からKnowledge APIを直接呼ばない。
- service workerはexact pathのPOSTを既存GET cache処理より先に扱う。raw bodyは128 KiBでstream readを停止し、fatal UTF-8、multipart boundary/header、C0/C1、`Bidi_Control`、ill-formed Unicode、field別上限、HTTP(S) URL/userinfoを検査する。HTML/scriptに見える選択文字列は実行・HTML parseせずplain textとして扱う。API、cookie、session、CSRF token、Cache API、logへcapture本文を渡さない。
- 正規化済みdraftは専用IndexedDB `erp4-share-target-drafts`だけへ保存する。各user gestureには独立したopaque draft IDとURLへ出さない独立request keyを128 bitで発行する。TTLは作成時から60分で延長せず、queueは最大10件、11件目は既存draftをevictせず拒否する。期限後は読取を直ちに拒否し、app起動時・可視化時・60秒interval・service worker activation／次のstaging時にbest-effortで物理削除する。browserが停止中の物理削除時刻は保証せず、次の実行機会に削除する。
- staging成功時は`Cache-Control: no-store`付き303を返し、`Location`には`shareTarget=<opaque id>`だけを含める。本文、元URL、request key、preview tokenをpath/query/fragmentへ入れない。refreshはPOSTを再送しない。explicit cross-site Fetch Metadata／Originは拒否し、native shareのopaque originは`Sec-Fetch-Site: none`へ限定する。Chromiumのservice worker `Request`が同一originのprogrammatic POSTでも`Origin`と`Sec-Fetch-Site`を両方公開しない互換経路は、local IndexedDB stagingだけに限定して受理する。このheaderless経路もAPI／cookie／CSRF／Knowledge mutationへ接続せず、最大10件、TTL、認証済みpreview、明示confirmを必須とする。headerの片方だけが欠落する、または明示cross-site値があるrequestは拒否する。
- 未認証landingはserver確認前にIndexedDB本文をcapture UIへhandoff／renderせず、localに保持中であることと破棄操作だけを表示する。TTL cleanupはbrowser profile内のrecordを走査・正規化するが、本文をDOM、network、Cache API、logへ渡さない。cached frontend authへfallbackせず`/auth/session`または`/me`の成功responseでserverが認証を確認した最初のactorへdraftをatomic claimし、raw actor IDを保存せずdomain-separated hashだけを保持する。share target POST時点ではservice workerがcookie/sessionを解析しないため、最初のclaim前のdraftはERP4 accountではなくbrowser profileをlocal trust boundaryとする。同じprofileを利用できる別のlocal利用者が先に認証するとfirst actorになり得るため、共有端末ではOS/browser profileを分離するか、意図したaccountで最初にログインできないdraftを破棄する。JWT BFFはcanonical `session.userAccountId`、header modeはverified `userId`を別namespaceで使い、互換表示用legacy user fieldの衝突をactor identityに使わない。claim後は同じbrowser profileでも別actorへ本文を返さず、claim済みdraftの削除も同じserver-confirmed actorだけに許可する。別tab logoutのstorage eventに加え、actorやauth dataを含まない専用BroadcastChannelのsession-generation通知、offline遷移、可視化時および60秒ごとのsession再検証、absolute TTL到達でhandoff済みDOM、preview、request intentをpurgeする。これによりlegacy user fieldとlocalStorage JSONが同一のままBFF canonical accountだけが変わる場合も即時にfail closedとする。session検証は15秒でabortし、定期／可視化eventはsingle-flight、auth/storage変化はcurrent responseを適用せず完了後のfresh verificationへ集約する。auth verification generationとdraft lifecycle generationを分離し、remote lifecycleがin-flight認証結果を無効化しない。認証再検証中は既存handoff UIを非表示にし、canonical actor変更後は旧actor keyで再読込せず新actorでclaimを再評価する。さらにpreview直前とresponse受領後、commit／read-only reconcile直前にcanonical server actorを非永続で再検証し、handoff actorと一致しなければlocal pending遷移やAPI mutationを開始せずsensitive stateをpurgeする。認証後かつKnowledge Hub mount完了後に一度だけ既存capture draft eventへhandoffする。offline中はdraftを保持して自動preview/commit/retryせず、online復帰時にserver sessionを再検証した後も利用者が明示操作する。
- local draft lifecycleは`staged`、`pending`、`cleanup_pending`の固定allowlistとする。commit I/O前にbackend正規化済みexact draftとselected fields／scope／group／source typeのpending intentをatomic保存し、pending reloadは同じpayload／intentのpreviewとread-only reconcileだけを許可して二度目のcommitを禁止する。別tabの異なる編集内容はpending遷移前に拒否し、確定的なdispatch前拒否だけexact draftを保持したままstagedへ戻す。pending IndexedDB transaction中に認証purgeまたはcomponent unmountが先行した場合は、transaction完了後にcaptured actor bindingのまま`staged`へ補償してAPI mutationを開始しない。CASでpending遷移を取得したtabだけがpending lifecycleを通知し、CAS敗者は通知を再送せずownerのin-flight commitをabortしない。owner通知がCAS待機中のtabをpurgeした場合、そのtabはstale UIを復元せずlandingによるexact pending reloadへ委ねる。補償書込み自体が失敗した場合は`pending`をfail closedで維持し、自動commitせずread-only確認を要求する。commit／failed／discardのterminal eventは本文とrequest keyをcontent-free tombstoneへ置換してから物理削除し、削除失敗時もreloadで本文を再表示しない。tombstone書込み失敗と物理削除失敗を別のlocal retry phaseとして保持し、前者の再試行は必ずtombstone遷移からやり直す。IndexedDB openが`blocked`後に遅れて成功した場合は呼出元へ渡らないconnectionを直ちにcloseする。同一originの複数tabはopaque draft IDとlifecycleだけの共有BroadcastChannel objectでremote pending／staged reloadとterminal purgeを同期し、送信tab自身のcommit／cleanupをabortせず、本文、actor、request keyをmessageへ入れない。pending/result unknownは自動削除せず保持する。
- service workerがまだinstall/controlされていない初回共有をbackend fallbackへ転送しない。保存済みと表示せず、PWAを一度起動してworker activationを確認後に再共有する運用とする。
- production／https-trial frontend imageは`VITE_AUTH_MODE=jwt_bff`を明示してbuildし、backendの`AUTH_MODE=jwt_bff`と一致させる。private-smokeだけはfrontend/backendとも`header`を明示する。`VITE_PWA_SHARE_TARGET_MODE`も`enabled|decommission`を明示し、未指定値に依存して公開環境をbuildしない。Quadlet image buildだけでなく公式release artifact workflowも`jwt_bff`と`enabled`を明示し、回帰testでrelease stepを検査する。rollback bridgeは`decommission` buildでmanifestとPOST intakeを停止し、既存draftのTTL／discard cleanupは維持する。worker helperはdeploymentごとに再検証できるno-cache responseとする。

#### Chrome / Edge Manifest V3 browser capture

- browser captureは独立したManifest V3 packageとしてbuildする。生成manifestのpermissionは`activeTab|scripting|storage`だけとし、`<all_urls>`、wildcard host permission、`cookies`、`tabs`、`history`、`webRequest`、clipboard、native messagingを要求しない。remote code、inline executable script、`eval`、`innerHTML`、browser cookie／ERP4 tokenの取得、ERP4 APIへの直接requestを禁止する。
- 利用者がbrowser actionを操作したときだけ、main frameから現在URL、document title、現在のselection、canonical link、description、author、published timeのallowlistを取得する。form/password値、DOM/HTML、iframe、script/style、arbitrary metadata、storage、history、screenshotは取得しない。page値はすべてuntrusted inputとしてcapture ingressと同じUnicode、byte、URL、total boundsで再検証し、plain textとしてpopupへ表示する。URL query名とpathはboundedな多層percent-decode後にもcredential/session tokenを検査し、nested URLのuserinfo、credential query、path/matrix parameter、非canonical slash／backslash、二重encodeもlocal staging前に拒否する。
- destination originは`ERP4_CAPTURE_ORIGIN`でbuild時に一つのexact originへ固定する。HTTPSを必須とし、明示test flag付きlocalhost以外のHTTP、userinfo、path、query、fragment、wildcardを拒否する。生成content scriptはそのoriginだけへ配置し、production実値をrepositoryへ保存しない。
- popupは選択／省略fieldとdestination originを表示し、利用者が`ERP4で確認`を操作するまでhandoffしない。draftは128-bit以上のopaque IDと独立request keyで`chrome.storage.session`へ最大10件保存し、論理read TTLを10分とする。期限後はreadを拒否し、recordは次のextension実行またはbrowser session終了時に物理削除する。本文はhandoff URLへ入れず、URLは`browserCapture=<opaque id>`だけとする。persistent local storage、自動送信、自動retryは使わず、browser session終了時にdraftが失われ得ることを表示する。
- exact ERP4 originのcontent scriptはpageのone-time commandをextension service workerへ中継するだけである。`event.source === window`、page origin、schema version、expected draft ID、nonce、canonical actorのdomain-separated fingerprintを検証し、nonce replayとactor switchを拒否する。fingerprintはserver-confirmed認証後の整合束縛であってserver署名されたattestationでもsame-origin XSSに対するauthenticationでもない。標準frontend imageはresponse CSPを生成し、scriptをselfと既存Google Identity endpointへ限定し、API `connect-src`をbuild時のexact `VITE_API_BASE` originへ束縛する。exact ERP4 originのapplication JavaScript、target環境で検証済みの実効CSP、XSS防止、locked browser profileを信頼境界とし、CSP証跡がないdeploymentではextensionを有効化しない。same-origin XSSまたはDevToolsを操作できるlocal userは、別originから取得したdraftを読取／削除し得る残存リスクとして扱う。認証済みERP4 landingはserver-confirmed actorを得るまでdraft本文を読まず、受信だけではmutationしない。preview／commit／reconcileは既存CSRF、exact preview token、request ledger、ACL境界を通す。
- extension-local lifecycleは`staged|pending`に限定し、commit I/O前にbackend正規化済みdraftとintentをsession storageへ固定する。同じoperationだけがidempotentに再開でき、別payload／actor／nonceを拒否する。draft TTL内に受理したnonceは最大32件の履歴からevictせず、上限到達後の非terminal commandはfail closedとする。fresh nonceによるterminal deleteはrecord全体を削除でき、response loss後のdeleteだけはnot-foundへidempotentに収束する。結果不明では自動再送せずread-only reconcileを表示する。commit、確定failed、discard後はsession draftを削除し、削除失敗時は再送ではなく削除だけを明示再試行する。
- Chrome／Edgeはunpacked extensionでpermission、action gesture、selection capture、popup、exact-origin handoff、duplicate、offline/manual retry、disable/uninstall rollbackを実browser version付きで検証する。Playwright Chromium E2Eまたはstatic compatibility reviewは実Chrome／Edge evidenceの代用にしない。

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
