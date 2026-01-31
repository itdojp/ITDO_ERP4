# external_chat 利用箇所の棚卸し（現状）

## backend
- chat系
  - `packages/backend/src/services/chatRoomAccess.ts`: `external_chat` 判定 + `allowExternalUsers` で閲覧/投稿可否に影響
  - `packages/backend/src/routes/chat.ts`: chat API の allowedRoles に含む / `@all` 禁止 / `allowAll=false`
  - `packages/backend/src/routes/chatRooms.ts`: allowedRoles に含む / `@all` 禁止 / ルーム作成・メンバー管理・外部LLM機能の禁止 等
  - `packages/backend/src/routes/chatBreakGlass.ts`: chatRoles に含む（break-glass 自体の要件は別途）
- chat以外
  - `packages/backend/src/routes/search.ts`: external_chat の場合、各種ドキュメント検索結果を返さない（projects/invoices/... が空）
  - `packages/backend/src/routes/notifications.ts`: 通知APIの allowedRoles に含む（閲覧自体は可）

## frontend
- `packages/frontend/src/sections/RoomChat.tsx`: external_chat 前提の表示/操作制御（例: project room 表示・UI制限）
- `packages/frontend/src/pages/App.tsx`: deep link 解決で external_chat の場合 project-chat ではなく room-chat を開く

## docs
- `docs/requirements/access-control.md`, `docs/requirements/chat-rooms.md`, `docs/requirements/project-chat.md`, `docs/manual/*` で
  `external_chat=外部ユーザ/チャットのみ` を前提

---

## 移行の含意
- 「チャット領域では external_chat を使わない（=グループACLへ統一）」は、上記のうち
  - chatRoomAccess/chat/chatRooms/frontend制御
  を置き換える必要がある。
- 一方で external_chat は現状、search 等の「チャット以外の機能抑止」にも使っているため、完全廃止は棚卸し結果を踏まえて判断が必要。

## 暫定案（手戻り抑制）
- まず「チャットの閲覧/投稿・@all・ルーム作成/管理」から external_chat 依存を外し、グループACL/ポリシーへ置換する。
- search 等の非チャット制限は当面 external_chat を残し、後続で「権限プロファイル（グループ/ポリシー）」へ移行する。
