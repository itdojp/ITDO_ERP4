# Chat API/画面 二重化の棚卸と統合方針（Issue #1314）

更新日: 2026-03-04  
関連Issue: #1314

## 1. 目的

- project系 (`/projects/:projectId/chat-*`) と room系 (`/chat-rooms/*`) の二重化箇所を棚卸する。
- 機能差分と移行リスクを整理し、統合（room系正規化）の初期方針を定義する。

## 2. API棚卸（backend）

## 2.1 project系

- `GET /projects/:projectId/chat-messages`
- `POST /projects/:projectId/chat-summary`
- `GET /projects/:projectId/chat-mention-candidates`
- `GET /projects/:projectId/chat-ack-candidates`
- `GET /projects/:projectId/chat-unread`
- `POST /projects/:projectId/chat-read`
- `POST /projects/:projectId/chat-messages`
- `POST /projects/:projectId/chat-ack-requests/preview`
- `POST /projects/:projectId/chat-ack-requests`
- `GET /projects/:projectId/chat-break-glass-events`

主実装: `packages/backend/src/routes/chat.ts`, `packages/backend/src/routes/chatBreakGlass.ts`

## 2.2 room系

- `GET /chat-rooms`, `POST /chat-rooms`, `PATCH /chat-rooms/:roomId`
- `POST /chat-rooms/:roomId/members`
- `GET /chat-rooms/personal-general-affairs`
- `GET/POST /chat-rooms/:roomId/messages`
- `POST /chat-rooms/:roomId/summary`, `POST /chat-rooms/:roomId/ai-summary`
- `GET /chat-rooms/:roomId/mention-candidates`
- `GET /chat-rooms/:roomId/ack-candidates`
- `POST /chat-rooms/:roomId/ack-requests/preview`
- `POST /chat-rooms/:roomId/ack-requests`
- `GET /chat-rooms/:roomId/unread`, `POST /chat-rooms/:roomId/read`
- `GET/PATCH /chat-rooms/:roomId/notification-setting`
- `GET /chat-messages/search`, `GET /chat-messages/:id`
- `GET /chat-rooms/:roomId/chat-break-glass-events`

主実装: `packages/backend/src/routes/chatRooms.ts`, `packages/backend/src/routes/chatBreakGlass.ts`

## 2.3 共通エンドポイント（project/room横断）

- `POST /chat-messages/:id/attachments`, `GET /chat-attachments/:id`
- `POST /chat-messages/:id/reactions`
- `POST /chat-ack-requests/:id/ack|cancel|revoke`, `GET /chat-ack-requests/:id`

主実装: `packages/backend/src/routes/chat.ts`

## 3. 呼び出し元棚卸（frontend）

## 3.1 project系呼び出し

主呼び出し元: `packages/frontend/src/sections/ProjectChat.tsx`

- 一覧/投稿: `/projects/:projectId/chat-messages`
- 未読/既読: `/projects/:projectId/chat-unread`, `/projects/:projectId/chat-read`
- メンション候補: `/projects/:projectId/chat-mention-candidates`
- ack-required: `/projects/:projectId/chat-ack-candidates`, `/projects/:projectId/chat-ack-requests*`
- 要約: `/projects/:projectId/chat-summary`
- break-glass履歴: `/projects/:projectId/chat-break-glass-events`

## 3.2 room系呼び出し

主呼び出し元: `packages/frontend/src/sections/RoomChat.tsx`, `packages/frontend/src/hooks/useChatRooms.ts`, `packages/frontend/src/sections/ChatRoomSettingsCard.tsx`

- ルーム一覧/作成/設定/メンバー管理
- 一覧/投稿: `/chat-rooms/:roomId/messages`
- 未読/既読: `/chat-rooms/:roomId/unread`, `/chat-rooms/:roomId/read`
- 通知設定: `/chat-rooms/:roomId/notification-setting`（`ProjectChat` 側も利用）
- ack-required: `/chat-rooms/:roomId/ack-*`
- 要約: `/chat-rooms/:roomId/summary`, `/chat-rooms/:roomId/ai-summary`

## 3.3 横断呼び出し（証跡/検索）

- `GET /chat-messages/:id`（deeplink/証跡参照）
- `GET /chat-messages/search`
- `GET/POST/DELETE /chat-ack-links*`
- `GET /ref-candidates?types=chat_message`

## 4. 機能差分（現状）

| 観点           | project系                   | room系                                                                                   | 統合時の注記                          |
| -------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| 検索           | `q` 非対応                  | `q` 対応 + 横断検索あり                                                                  | room系に寄せると機能は強化される      |
| メンション候補 | projectMember 中心          | project room時は `projectMember` + （`allowExternalUsers=true` 時のみ）room member/group | PR #1333 で候補不足差分を是正済み     |
| 通知設定       | 専用APIなし                 | 専用APIあり                                                                              | 既に `ProjectChat` も room API を利用 |
| アクセス制御   | `requireProjectAccess` 中心 | `ensureChatRoomContentAccess`（viewer/poster/member/group）                              | room正規化で 403 が増える可能性       |
| ack-required   | あり                        | あり（`accessLevel:'post'` 強制）                                                        | room系に統一可能                      |
| 添付/reaction  | 共通API                     | 共通API                                                                                  | 差分なし                              |

## 5. 初期統合方針（TODO1）

## 5.1 正とする経路

- room系 (`/chat-rooms/*`, `/chat-messages/*`) を正規経路とする。
- project系 (`/projects/:projectId/chat-*`) は互換aliasとして段階縮退する。

## 5.2 互換期間方針

- `redirect` は原則採用しない（POST互換性リスク回避）。
- backend 側で project path を room 処理へ委譲（alias）。
- 並存期間は 8〜12週間（または 2リリース）を目安にし、旧経路利用が 0 になった後に廃止する。

## 5.3 deprecate方針（初期）

- 旧project系経路の利用時に `Deprecation: true` ヘッダを返す（backend共通フックで付与）。
- 旧project系経路の利用時に audit/ログで `legacy_project_chat_path_used` を記録（後続実装）。
- OpenAPI と docs に deprecate 注記を追加。
- Sunset 日付は実利用データを見て確定（現時点では未確定）。

## 6. 先行で解消すべきリスク

1. project room でのメンション候補差分（候補不足）
2. ACL差分による403増（project access と room ACL の差）
3. `ref-candidates(chat_message)` が project room 限定である点

## 7. 段階移行（提案）

1. **Phase 0（棚卸完了）**: 本ドキュメント + issue checklist 更新
2. **Phase 1（安全性先行）**: room投稿の `accessLevel:'post'` を徹底（権限境界の是正）
3. **Phase 2（backend統合）**: project path を alias 化し、roomロジックへ委譲
   - 先行実装: unread/read の集計・既読更新ロジックを `chatReadState` サービスへ共通化
   - 先行実装: mention-candidates の候補解決ロジックを `chatMentionCandidates` サービスへ共通化
4. **Phase 3（frontend統合）**: `ProjectChat` 呼び出しを room API へ段階移行
5. **Phase 4（deprecate）**: 旧project系経路の無通信確認後に削除
