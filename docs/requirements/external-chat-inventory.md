# external_chat 利用箇所の棚卸し（現状）

## backend
- chat系
  - `packages/backend/src/services/chatRoomAccess.ts`: room ACL（viewer/poster + member + allowExternalUsers）で制御
  - `packages/backend/src/routes/chat.ts`: chat API の allowedRoles に含む（ロールによる禁止は行わない）
  - `packages/backend/src/routes/chatRooms.ts`: allowedRoles に含む（@all/作成/メンバー管理/外部LLMの禁止は撤去）
  - `packages/backend/src/routes/chatBreakGlass.ts`: chatRoles に含む（break-glass 自体の要件は別途）
- chat以外
  - `packages/backend/src/routes/search.ts`: external_chat の場合、各種ドキュメント検索結果を返さない（projects/invoices/... が空）
  - `packages/backend/src/routes/notifications.ts`: 通知APIの allowedRoles に含む（閲覧自体は可）

## frontend
- `packages/frontend/src/sections/RoomChat.tsx`: project room の表示/遷移は projectIds ベースで分岐
- `packages/frontend/src/pages/App.tsx`: deep link は projectIds/ロールで project-chat / room-chat を切替

## docs
- `docs/requirements/access-control.md`, `docs/requirements/chat-rooms.md`, `docs/requirements/project-chat.md`, `docs/manual/*` で
  `external_chat=外部ユーザ/チャットのみ` を前提

---

## 移行の含意
- チャット領域は external_chat 依存を撤去し、グループACL（viewer/poster + member）へ統一済み。
- 一方で external_chat は現状、search 等の「チャット以外の機能抑止」にも使っているため、完全廃止は棚卸し結果を踏まえて判断が必要。

## 暫定案（手戻り抑制）
- chat の依存除去は完了。search 等の非チャット制限は当面 external_chat を残し、後続で「権限プロファイル（グループ/ポリシー）」へ移行する。
