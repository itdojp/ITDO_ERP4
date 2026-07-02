# Frontend server-state and large component split plan

## 目的

`AdminSettings.tsx` と `RoomChat.tsx` に集中していた fetch、キャッシュ相当の配列 state、フォーム state、表示ロジックを段階的に分離し、UI 変更時の回帰リスクとレビュー負荷を下げる。

## 2026-07-02 の判断: TanStack Query は段階導入（本PRでは依存追加しない）

### 判断

- `@tanstack/react-query` は **条件付きで採用候補** とする。
- Issue #1857 の初回PRでは新規依存を追加せず、先に責務分割と max-lines gate を入れる。
- 次フェーズで、query key、mutation invalidation、楽観更新/再取得の責務を hook 単位で固定できる画面から導入する。

### 理由

1. 現状の `AdminSettings.tsx` / `RoomChat.tsx` は、サーバ状態、フォーム入力、Undo、Deep link、添付、ack などの UI 一時状態が混在していた。
2. その状態で直接 React Query を導入すると、依存追加だけが先行し、query/mutation の境界が不明確なままになる。
3. `@tanstack/react-table` / `@tanstack/react-virtual` は採用済みだが、server-state の導入価値は query key と invalidation の設計が固定されて初めて出る。
4. 既存E2Eの安定性を優先し、まず表示責務を分割して局所テスト・レビュー単位を小さくする。

## 今回の責務分割

### AdminSettings

- `admin-settings/adminSettingsModel.ts`
  - 管理設定の型、定数、既定フォーム、JSON/日時/CSV helper を集約。
- `admin-settings/AdminSettingsPolicyPanel.tsx`
  - 承認ルール、ActionPolicy、ack template の表示責務を本体から分離。
- `AdminSettings.tsx`
  - データ取得、mutation handler、カテゴリ横断の orchestration を保持。

### RoomChat

- `room-chat/roomChatModel.ts`
  - チャット型、メンション/添付/検索/Markdown helper、ルーム表示 helper を集約。
- `room-chat/RoomMessageList.tsx`
  - メッセージ一覧、ack表示、リアクション、添付ダウンロードUIを分離。
- `room-chat/RoomGlobalSearch.tsx`
  - 横断検索フォームと検索結果一覧を分離。
- `RoomChat.tsx`
  - ルーム選択、投稿フォーム、通知設定、API orchestration を保持。

## React Query 導入候補の境界

| priority | candidate hook                       | query key / mutation boundary                                                 | 備考                                              |
| -------- | ------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| 1        | `useChatMessages(roomId, filter)`    | `['chatMessages', roomId, filter]` / post, reaction, ack, attachment mutation | 一覧・ページング・再読込の重複削減効果が大きい    |
| 2        | `useChatRooms(scope)`                | `['chatRooms', scope]` / create, invite mutation                              | ルーム一覧と Deep link 復元の再取得条件を整理する |
| 3        | `useAdminSettingsResource(resource)` | alert/rule/actionPolicy/template/integration ごとの query key                 | category card 単位で段階導入する                  |

## 導入ゲート

React Query を追加するPRでは、次を同時に満たす。

1. `QueryClientProvider` の配置と test wrapper を明示する。
2. query key と invalidation 方針をこのドキュメントへ追記する。
3. 対象 hook に unit test または component test を追加する。
4. `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh` を通す。
5. 新規依存追加の理由・影響・ロールバックをPR本文に記載する。

## 行数ゲート

frontend lint では `max-lines` を 2500 行（blank行を除外）で有効化する。これは初期導入値であり、既存の巨大コンポーネントを 2500 行未満へ落とした後、カテゴリ分割・hook抽出に合わせて 2000 行、1500 行へ段階的に下げる。
