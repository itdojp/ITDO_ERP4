# プロジェクトチャット仕様（統合）

## 目的/スコープ
- プロジェクト単位の簡易グループチャットを提供する
- MVPは「投稿/閲覧/タグ/リアクション/ページング」に限定する
- 監査/通知/リアルタイム配信は後続スコープ

## 役割/アクセス制御
- 許可ロール: admin / mgmt / user / hr / exec / external_chat
- admin/mgmt は全プロジェクトにアクセス可能
- それ以外のロールは `projectIds` に含まれる案件のみアクセス可能
- `external_chat` はチャットのみ利用可（他機能は不可）

## データモデル
### ProjectChatMessage
- `id`: UUID
- `projectId`: 参照先 `Project`
- `userId`: 投稿者のID
- `body`: メッセージ本文
- `tags`: JSON配列（文字列のタグ一覧）
- `reactions`: JSONマップ（emoji -> { count, userIds[] }）
- `createdAt/createdBy`, `updatedAt/updatedBy`
- `deletedAt/deletedReason`（論理削除用、API未実装）

### インデックス
- `projectId, createdAt`

## API
### GET `/projects/:projectId/chat-messages`
**Query**
- `limit` (default 50, max 200)
- `before` (ISO日時。これ以前のメッセージを取得)
- `tag` (任意。タグが一致するメッセージのみ)

**挙動**
- `createdAt` 降順で取得
- `tag` はトリム後の完全一致でフィルタ
- `tag` が空/未指定の場合はフィルタなし

**エラー**
- `limit` が正数でない場合は 400
- `before` が不正な日付の場合は 400
- `tag` が 32 文字超の場合は 400

### POST `/projects/:projectId/chat-messages`
**Body**
- `body` (1〜2000文字)
- `tags` (任意: 0〜8件、各32文字まで)

**挙動**
- `userId` は認証情報から取得
- 認証情報が不足する場合は `demo-user` をフォールバック（PoC向け）
  - 本番環境では無効化し、401/403 を返す前提
  - `demo-user` は明示的な設定フラグでのみ有効化する

### POST `/chat-messages/:id/reactions`
**Body**
- `emoji` (1〜16文字)

**挙動**
- 同一ユーザの同一emojiは1回のみ加算
- 形式は `{ emoji: { count, userIds[] } }`
- 既存データが数値の場合は互換扱いで更新する

## UI（ProjectChat）
- プロジェクト選択、読み込み、投稿、タグ表示、リアクション
- タグ絞り込み入力（適用は「読み込み」ボタン）
- 追加読み込み（`before` 使用）
- 既定のリアクション候補: 👍/🎉/❤️/😂/🙏/👀

## バリデーション/制約
- 本文: 1〜2000文字
- タグ: 最大8件、各32文字
- リアクションemoji: 1〜16文字

## テスト
- E2Eスモークに「投稿/リアクション」含む
  - `packages/frontend/e2e/frontend-smoke.spec.ts`

## 未実装/後続スコープ
- メッセージ編集/削除（論理削除API）
- リアクションの取り消し（トグル）
- 添付/画像/ファイル
- リアルタイム更新（WS/ポーリング）
- メンション/通知連携
- 複数タグの AND/OR 検索

## 関連ドキュメント
- `docs/requirements/data-model-sketch.md`
- `docs/requirements/domain-api-draft.md`
- `docs/requirements/frontend-api-wire.md`
- `docs/requirements/rbac-matrix.md`
- `docs/requirements/access-control.md`
