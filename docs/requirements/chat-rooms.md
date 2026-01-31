# チャット: ルーム化（project chat → room chat）移行方針（確定）

## 背景
現状のチャットは `projectId` 直結（`ProjectChatMessage`）であり、以下を本格実装するには「ルーム」という単位が必要です。

- 公式/私的/DM の切り替え（会社の「認知」範囲の統制）
- break-glass（監査目的の閲覧申請→二重承認→閲覧許可→監査ログ）※ #434/#454
- 部門/全社ルーム（案件と独立したチャネル）
- 外部ユーザ（external_chat）の参加制御（許可ルームのみ）

## 目的
- room-based chat のデータモデル/API/移行手順を確定し、後続の break-glass / DM / 部門/全社ルームへ進める。
- 既存の ProjectChat（PoC）の利用を壊さず、段階的に移行できる構成にする。

## 用語
- **ルーム（Room）**: メッセージが流れる単位（Slackのchannel相当）
- **公式ルーム（Official）**: 会社が統制する前提のルーム（外部連携/外部ユーザ/外部LLM等を許可し得る）
- **私的ルーム（Private）**: 社員自治を基本とするが、必要時に break-glass で監査閲覧可能なルーム
- **DM**: 私的ルームの一種（1:1）。管理者設定で無効化可能。

## ルーム種別（案）
DB上は `type` として表現し、ポリシー（公式/私的、外部連携可否など）は room の属性で決めます。

- `project`: 案件ルーム（Projectに紐付く）
- `department`: 部門ルーム（Groupに紐付く）
- `company`: 全社ルーム（組織全体）
- `private_group`: 私的グループ（ユーザが作成）
- `dm`: DM（ユーザ2名のprivate_group特化）

## ルームIDの決め方（MVP）
- `project`: `ChatRoom.id = Project.id`（`roomId = projectId`）
- `company`: 固定（`ChatRoom.id = "company"`）
- `department`: 決定的ID（`ChatRoom.id = "dept_" + sha256(groupAccountId).slice(0,32)`）、`ChatRoom.groupId = GroupAccount.id (UUID)`
- `private_group`: `uuid`
- `dm`: 決定的ID（`ChatRoom.id = "dm_" + sha256(userA + "\\n" + userB).slice(0,32)`）

## データモデル（案）
最小構成（MVP）として以下を想定します（命名は例）。

- `ChatRoom`
  - `id`
  - `type`（project/department/company/private_group/dm）
  - `name`（project/department/company は自動生成可）
  - `isOfficial`（公式ルーム判定）
  - `projectId?` / `groupId?`（typeに応じて片方を使う。`groupId` は GroupAccount.id を保持）
  - `viewerGroupIds?`（閲覧可能グループの allow-list。UUIDを保持）
  - `posterGroupIds?`（投稿可能グループの allow-list。UUIDを保持）
  - `allowExternalUsers`（external_chatの参加を許可するか）
  - `allowExternalIntegrations`（Webhook/外部通知/外部LLM等を許可するか。公式のみtrue想定）
  - `createdAt/createdBy`, `updatedAt/updatedBy`, `deletedAt/deletedReason`

- `ChatRoomMember`
  - `roomId`, `userId`
  - `role`（owner/admin/member）
  - `createdAt`, `deletedAt/deletedReason`

- `ChatMessage`
  - `roomId`, `userId`, `body`（Markdown）
  - `tags` / `reactions` / `mentions` / `mentionsAll`
  - `createdAt/createdBy`, `updatedAt/updatedBy`, `deletedAt/deletedReason`
  - `messageType`（normal/system/ack_request など。MVPはnormal+systemを想定）

- `ChatReadState`
  - `roomId`, `userId`, `lastReadAt`（自分のみ）

- `ChatAttachment`
  - `messageId`, `provider`（local/gdrive）, `providerKey`, `sha256`, `sizeBytes`, `mimeType`, `originalName`
  - `createdAt/createdBy`, `deletedAt/deletedReason`

- `ChatAckRequest` / `ChatAck`
  - 既存の「確認メッセージ」（OK追跡）と同等

補足
- projectルーム（`type=project`）は **`roomId = projectId`** として扱う（`ChatRoom.id = Project.id`）。
- 監査/改ざん検知・論理削除方針は `docs/requirements/project-chat.md` の方針を踏襲します。
- break-glass 用のテーブルは別（#454）で設計/実装しますが、参照先は `roomId` とします。

## アクセス制御（案）
- **ルームの存在（メタ情報）**
  - admin/mgmt/exec は全ルームのメタ情報を参照可能（会社の「認知」）
  - user/hr は自分が参加しているルーム + 全社/部門ルーム（groupIds由来）を参照可能
  - external_chat は「許可されたルームのみ」
- **メッセージ閲覧**
  - project: ProjectMember と同等扱い（room member は持たない）
  - company: internal role（admin/mgmt/exec/user/hr）なら閲覧/投稿可（room member 不要）
  - department: `groupAccountIds` に `ChatRoom.groupId` が含まれる場合に閲覧/投稿可（room member 不要）
    - 互換期間は displayName でも判定（dual-read）
  - `viewerGroupIds` が設定されている場合は、上記の条件に加えて `viewerGroupIds` に含まれるユーザのみ許可
- private_group/dm: room member のみ閲覧/投稿可
- break-glass: mgmt/exec は申請 + 二重承認で私的ルーム/DMも監査閲覧可能

- **メッセージ投稿**
  - `posterGroupIds` が設定されている場合は、`posterGroupIds` に含まれるユーザのみ許可

## 移行戦略（推奨）
**推奨: 新テーブル導入 + project chat を段階移行**

1) **Step 1: roomテーブルを追加（影響なし）【完了】**
   - `ChatRoom` / `ChatRoomMember` を追加（#464）
   - projectルームは on-demand / project作成時に生成

2) **Step 2: room API を追加（既存project chatは維持）【部分完了】**
   - `GET /chat-rooms`（一覧）（#465）
   - ProjectChat の案件選択を room一覧に切替（#469）
   - private_group/DM の作成/招待/room chat API（#479）

3) **Step 3: project chat API を room に寄せる（互換を維持）【完了】**
   - 既存の `/projects/:projectId/chat-*` は `Chat*`（room-based）参照へ移行（#472）
   - break-glass の閲覧対象も `ChatMessage` に切替（#472）

4) **Step 4: 既存データの移行【完了】**
   - migration `20260112003555_add_chat_room_messages` で `ProjectChat*` → `Chat*` をコピー
   - `prisma migrate deploy` を使う環境で適用される（`prisma db push` はデータ移行を含まない）

5) **Step 5: 旧ProjectChat* テーブルを凍結 → 廃止【完了】**
   - 移行検証SQL: `scripts/checks/chat-migration-step5.sql`
   - 削除migration: `20260112030000_drop_legacy_project_chat`（不整合がある場合は失敗する）

## 既存仕様との整合
- メンション/未読/確認メッセージ/添付/通知/AI要約は「Room単位」で提供する想定です。
- 既存の ProjectChat UI は「projectルームのフロント」として継続し、room UI（一覧/作成）は別画面として追加します。

## 未決定（後続で確定）
- 公式ルームの作成/管理権限（project leader の範囲）
- projectルームのメンバー同期（ProjectMemberの自動同期 vs room member の別管理）
- break-glass の cooldown（MVPは0想定）
