# チャット: ルーム化（project chat → room chat）移行方針（案）

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

## データモデル（案）
最小構成（MVP）として以下を想定します（命名は例）。

- `ChatRoom`
  - `id`
  - `type`（project/department/company/private_group/dm）
  - `name`（project/department/company は自動生成可）
  - `isOfficial`（公式ルーム判定）
  - `projectId?` / `groupId?`（typeに応じて片方を使う）
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
- 監査/改ざん検知・論理削除方針は `docs/requirements/project-chat.md` の方針を踏襲します。
- break-glass 用のテーブルは別（#454）で設計/実装しますが、参照先は `roomId` とします。

## アクセス制御（案）
- **ルームの存在（メタ情報）**
  - admin/mgmt/exec は全ルームのメタ情報を参照可能（会社の「認知」）
  - user は自分が参加しているルームのみ
  - external_chat は「許可されたルームのみ」
- **メッセージ閲覧**
  - 公式ルーム: メンバーは閲覧可能（projectルームは project member と同等扱いを想定）
  - 私的ルーム/DM: メンバーのみ閲覧可能、会社側は break-glass 経由でのみ閲覧可能

## 移行戦略（推奨）
**推奨: 新テーブル導入 + project chat を段階移行**

1) **Step 1: roomテーブルを追加（影響なし）**
   - `ChatRoom` / `ChatRoomMember` を追加
   - projectルームの生成方針を決める（例: project参照時に on-demand 作成）

2) **Step 2: room API を追加（既存project chatは維持）**
   - `GET /chat-rooms`（一覧）
   - `POST /chat-rooms`（作成：公式/私的）
   - `POST /chat-rooms/:id/members`（招待）
   - DMはMVPでは無効（管理者設定導入後に開始）

3) **Step 3: project chat API を room に寄せる（互換を維持）**
   - `GET /projects/:projectId/chat-messages` は内部的に projectルームを参照して返す
   - 新規投稿は room の message テーブルへ書く（移行後）

4) **Step 4: 既存データの移行**
   - `ProjectChatMessage` → `ChatMessage` へ移行するバッチ/スクリプト
   - `ProjectChatAttachment/ReadState/Ack...` も room 系へ移行
   - 互換維持のため、移行期間は project chat API で両面対応（読取は旧+新、書込は新）

5) **Step 5: project chat テーブルを凍結 → 廃止**
   - 旧APIを廃止する前に、移行完了の監査ログ/件数検証を残す

## 既存仕様との整合
- メンション/未読/確認メッセージ/添付/通知/AI要約は「Room単位」で提供する想定です。
- 既存の ProjectChat UI は「projectルームのフロント」として継続し、room UI（一覧/作成）は別画面として追加します。

## 未決定（後続で確定）
- DMを許可するか（許可する場合も私的ルームとして同一ポリシー）
- 公式ルームの作成/管理権限（project leader の範囲）
- projectルームのメンバー同期（ProjectMemberの自動同期 vs room member の別管理）
- break-glass の cooldown（MVPは0想定）

