# プロジェクトチャット仕様（統合）

## 目的/スコープ
- ERPと統合されたチャット機能として、Slack/Chatwork代替を目指す
- プロジェクト情報/タスク/承認などERPの情報と連動した利用を想定する
- AIを取り込み、要約/アクション抽出などの支援を行う（詳細は決定待ち）

## 現状（実装済み）
- プロジェクト単位の簡易グループチャット（room-based: `ChatRoom(type=project)` + `ChatMessage`）
- 公式ルーム（全社/部門）+ ルーム設定（外部ユーザ許可/外部連携許可）
- private_group/DM（room-based: `ChatRoom(type=private_group/dm)` + `ChatMessage`）
- 投稿/閲覧/タグ/リアクション/ページング
- メンション（ユーザ/グループ/@all）+ @all の投稿制限
- 未読/既読（自分のみ）
- 確認メッセージ（OK追跡）
- 添付（local/gdrive）+ 監査ログ（upload/download）
- メンション通知（アプリ内 / `/notifications`）
- 手動要約スタブ（UI: project/room）
- 外部要約（公式ルームのみ、外部連携ON時。監査ログ必須）: `docs/requirements/chat-external-llm.md`

## 未実装（後続）
- 検索（チャットのみ/ERP横断）とインデックス
- 通知チャネルの拡張（メール/Push/外部連携）
- リアルタイム配信（WebSocket等）

## 役割/アクセス制御
- 許可ロール: admin / mgmt / user / hr / exec / external_chat
- admin/mgmt は全プロジェクトにアクセス可能
- それ以外のロールは `projectIds` に含まれる案件のみアクセス可能
- `external_chat` はチャットのみ利用可（他機能は不可）
  - 参加可能なルームは「許可されたルーム」のみ（招待/許可制）
    - MVP: `allowExternalUsers=true` かつ `ChatRoomMember` 登録されたルーム（project/company/department）に限定
  - DM は禁止

## 決定事項（見直し反映）
- 既読/未読状態を保持する
- 自分の未読は自分のみが確認できる（未読件数/新着強調など）
- 自分以外の未読/既読状態は表示しない（いわゆる既読表示はしない）
- メンションは必須
- メンション対象は補完選択で指定できる（ユーザ/グループ/全員）
  - 全員宛（@all）は投稿前の確認メッセージ + 投稿回数制限を行う
- 本文はMarkdownで記述する
- 通知/添付/検索はERP統合として望ましい形で設計する（原則のみ決定。詳細な方式は「未決定/要設計」を参照）
- 監査目的の break-glass（監査閲覧）を提供する（理由必須 + 監査ログ必須 + 二重承認を想定）
  - break-glass を使った事実が分かる仕組みを入れる（バナー/システムメッセージ/履歴）
- 投稿内容は完全削除できない（論理削除 + 監査保全。削除しても監査上は追跡可能）
- 外部連携（Webhook/外部通知など）は公式ルームのみ許可する

## 未決定/要設計（ベース方針）
### ベース（案）
- チャット単位は「プロジェクト/部門/全社/DM」を含める
  - DM は管理者設定で無効化できる
- 自分の未読は自分のみが全てわかる（未読件数/未読ハイライト）
  - 自分以外の未読/既読状態は表示しない
- 指定した対象者の「OK/確認」状況を追える確認メッセージ（特別メッセージ）を提供する（方式は要設計）
- メンションの種類: ユーザ / グループ / 全員（補完選択で指定）
  - 全員宛（@all）は投稿前確認 + 投稿回数制限
- 検索の対象範囲は設定で選択できる
  - チャットのみ / ERP横断
- 通知チャネル（アプリ内/メール/Push/外部連携）と通知条件は設定で選択できるようにする（詳細検討）
- AI機能の範囲: 要約/アクション抽出/FAQ/検索支援（詳細検討）
- 外部ユーザ（external_chat）は「許可されたルーム」のみ参加可、DMは禁止

### 詳細検討（論点）
- Markdown方言（CommonMark/GFMなど）とサニタイズ方針
- 添付の保存先: Google Drive を候補として検討（権限制御/共有モデル/監査/容量/ウイルス対策）
  - Google側の「システムユーザのみが読み書きできる領域」を専用ストレージとして利用する案（Drive連携案に相当）
  - セットアップ手順: `docs/requirements/chat-attachments-google-drive.md`
- ルーム化（project chat→room chat）の移行方針: `docs/requirements/chat-rooms.md`（#453）
- ERP横断検索の範囲と権限制御、インデックス方式
- 通知の既定値、ミュート/頻度制御、外部連携の扱い（公式ルームのみ）
- AIの実装方式（ローカル/外部LLM）、権限/監査（外部LLM送信は外部連携扱い）

## ガバナンス設計（案）
### ルームの種別
- 公式ルーム（会社が把握・統制する前提）
  - 例: 案件ルーム（Project）、部門/全社ルーム（Group/Role）
  - 作成/管理: admin/mgmt（案件ルームについては project leader の限定操作を後続で追加検討）
  - 外部連携（Webhook/外部通知/外部ユーザ招待/外部LLM等）を許可できるのは公式ルームのみ
- 私的ルーム（社員の自治を基本とするが、会社が監査できる前提）
  - 作成/管理: user（内部ユーザ）のみ。external_chat は作成不可
  - ルーム管理者（room owner）を必須にし、ルーム管理者不在を許さない（自治の責任者を明確化）
  - 内容は通常閲覧不可で、監査目的の break-glass によってのみ閲覧可能
  - 私的ルームは外部連携を禁止（外部連携が必要なら公式ルームとして作成する）
  - DM（1:1）は私的ルームの一種として扱う（管理者設定でDMを無効化できる）
    - external_chat はDM禁止
    - DMのルーム管理者（owner）の扱いは要設計（例: 両参加者を owner とみなす）

### 「会社が認知する」範囲（決定: B）
- 会社（admin/mgmt/exec/監査権限者）は、ルームの存在とメタ情報を把握できる（常時監視ではなく「把握できる」状態）
  - 例: roomId / 種別 / 表示名 / 作成者 / ルーム管理者 / メンバー数 / 最終発言時刻 / 外部連携の有無
  - メンバー一覧の閲覧を許可する（閲覧自体も監査ログ対象とする）
- 通常の管理権限では本文/添付の「内容」は閲覧できない（内容は break-glass 経由のみ）
- 監査目的の break-glass（理由+ログ+承認）により、必要時は内容も閲覧できる

### 私的グループの自治（案）
- 私的グループは、ルーム管理者（room owner）を必須とする
  - 参加者の招待/退出、ルーム設定変更の責任を持つ
  - ルーム管理者が不在にならないように、退出時はルーム管理者移譲を必須にする
- 自治の前提（案）
  - 私的ルームでも、会社の情報セキュリティ/コンプライアンス規程の対象（「会社のシステム上のコミュニケーション」であることは明示する）
  - 会社は常時監視しないが、通報や監査要請があった場合は、規程に基づき調査できる状態（break-glass）を担保する
- 会社責任とのトレードオフ
  - 運用は自治（会社が常時監視しない）としつつ、監査・調査の必要が生じた場合に break-glass を行える状態にする
  - 会社側の強制措置（強制アーカイブ/凍結/退会など）が必要になる場合は、すべて理由必須 + 監査ログ必須

### 会社側の強制措置（案）
- 想定アクション: ルーム凍結（read-only）/ 強制アーカイブ / 外部連携停止 / ルーム管理者再設定 / メンバー強制退会
- すべて `reasonCode + reasonText` を必須とし、監査ログへ記録する
- 原則としてルーム内にシステムメッセージを残す（強制措置が行われた事実が消えない）

### 外部連携（決定）
- 外部連携できるのは公式ルームのみ
  - 私的ルームは、外部ユーザ招待や外部通知/Webhookを禁止する
  - AIが外部LLM等に送信する方式の場合は「外部連携」とみなし、公式ルームのみ許可（私的ルームはデフォルト無効）

## 監査目的 break-glass（案）
### 目的
- 不正/ハラスメント/情報漏えい等の調査、監査対応のために、私的ルームを含むチャット内容へ例外的にアクセスできる仕組みを提供する

### 監査の原則（案）
- 監査閲覧は「例外」であり、目的外利用を禁止する（申請理由と実施理由を監査ログで追えること）
- 監査閲覧は read-only（投稿/リアクション/編集/削除などの操作は不可）
- 監査閲覧で参照した範囲（ルーム、期間、添付の取得など）を監査ログに残す

### ワークフロー（案）
1. 監査閲覧申請（request）
   - 申請者: mgmt/exec（MVP案。admin は申請者にしない）
   - 入力: reasonCode + reasonText（必須）、対象ルーム、対象期間（デフォルト例: 30日）、閲覧期間（TTL）、閲覧者（監査担当）
2. 二重承認（approve）
   - 例: mgmt + exec の二重承認（同一人物/同一ロールのみでの完結を不可）
3. 閲覧許可（grant）
   - 許可された監査者のみ閲覧可能
   - 閲覧可能期間（例: 24h）を過ぎたら自動失効
4. 閲覧実行（access）
   - 実際に閲覧した事実（誰が/いつ/どの範囲）を監査ログへ記録

### reasonCode（案）
- `harassment`（ハラスメント）
- `fraud`（不正）
- `security_incident`（情報漏えい/セキュリティ事故）
- `legal`（法令/監査対応）
- `other`（その他）

### 「事前に分かる」仕組み（案）
- 監査閲覧が申請/承認された時点で、ルーム内にシステムメッセージ・バナーを表示して通知する
- 少なくとも私的ルームのルーム管理者には必ず通知する（MVPは全メンバーにも表示）
- 通知表示と閲覧権付与は同一トランザクションで確定し、通知が残らない状態での閲覧を不可能にする
- 通知内容（案）
  - requestId / 対象期間 / 閲覧者（監査担当）/ reasonCode を含める
  - reasonText は、ルームメンバーへの通知には含めない（監査ログ/監査画面でのみ参照）
- 猶予時間（cooldown）を導入する場合は、公式/私的で別設定可能にする（MVPは cooldown=0 を想定）

### break-glass を使ったことが分かる仕組み（案）
- 閲覧申請/承認/閲覧開始/閲覧終了のタイミングで「システムメッセージ」を残す
  - システムメッセージは削除不可（閲覧の事実が消えない）
  - 少なくともルーム管理者は必ず視認できる（MVPは全メンバーに表示）
- 監査閲覧の履歴（requestId、申請者、承認者、閲覧者、対象期間、実行日時、理由）をルーム設定/監査画面から参照できる
  - 参照権限（案）: ルーム管理者 + mgmt/exec
  - reasonText の参照は mgmt/exec のみ（ルーム管理者は reasonCode まで）

### 改ざん・削除対策（案）
- チャットはハードデリート禁止（後述）
- break-glass の申請/承認/閲覧は削除不可の監査ログとして残す
- 監査ログは既存の改ざん検知（ハッシュチェーン/外部保全方針）と整合させる

## 削除/編集/保持（案）
- 投稿は原則「編集」ではなく「追記」を推奨（運用/UXは要検討）
- 編集を許可する場合は revision を保持し、監査閲覧では改版履歴も閲覧できる
- 削除は論理削除（表示上は「削除済み」に置換）とし、原文は監査上の追跡が可能な形で保持する
  - ユーザ向けには削除できたように見えても、監査目的の閲覧や監査ログでは追跡可能（完全削除は不可）
  - 削除理由を必須化し、用途別に扱えるようにする（例: `user_retract` / `admin_moderation` / `legal_hold` / `other`）

## データモデル
### 現行（room-based）
- Prisma: `packages/backend/prisma/schema.prisma` を正とする
- 主テーブル: `ChatRoom` / `ChatMessage` / `ChatAttachment` / `ChatReadState` / `ChatAckRequest` / `ChatAck`
- break-glass: `ChatBreakGlassRequest` / `ChatBreakGlassAccessLog`
- projectルームは `roomId = projectId`（`ChatRoom.id = Project.id`）
- `ProjectChat*`（legacy）は Step 5 で削除済み（migration: `20260112030000_drop_legacy_project_chat`）

## データモデル（後続案）
- ChatMention（メンションの正規化: `messageId`, `targetType`, `targetId`）
- ChatMessageRevision（編集履歴）/ system message の正規化
- 検索用インデックス（チャット単体/ERP横断）

## API
### 現行API
※ 内部実装は room-based（Chat*）へ移行済み（外部APIは互換維持）。
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
- `mentions` (任意)
  - `userIds` (任意: 0〜50件)
  - `groupIds` (任意: 0〜20件)
  - `all` (任意: `true` の場合は @all 扱い)

**挙動**
- `userId` は認証情報から取得
- 認証情報が不足する場合は `demo-user` をフォールバック（PoC向け）
  - 本番環境では無効化し、401/403 を返す前提
  - `demo-user` は明示的な設定フラグでのみ有効化する
- `mentions.all=true` の場合は投稿回数制限（rate limit）を適用する
  - `CHAT_ALL_MENTION_MIN_INTERVAL_SECONDS` (default: 3600)
  - `CHAT_ALL_MENTION_MAX_PER_24H` (default: 3)
  - 超過時は 429 を返す

### POST `/projects/:projectId/chat-ack-requests`
**Body**
- `body` (1〜2000文字)
- `requiredUserIds` (1〜50件)
- `dueAt` (任意: ISO日時)
- `tags` (任意: 0〜8件、各32文字まで)
- `mentions` (任意)
  - `userIds` (任意: 0〜50件)
  - `groupIds` (任意: 0〜20件)
  - `all` (任意: `true` の場合は @all 扱い)

**挙動**
- 通常メッセージ + `ProjectChatAckRequest` を1トランザクションで作成する
- `requiredUserIds` はトリムして重複排除する（API側で正規化）
- `mentions.all=true` の場合は投稿回数制限（rate limit）を適用する（詳細は `POST /chat-messages` と同様）

### GET `/projects/:projectId/chat-mention-candidates`
**挙動**
- UIでの補完選択用に、ユーザ候補（案件メンバー中心）とグループ候補（JWTの `group_ids`）を返す
- `allowAll=false` の場合、UIは @all を選べない（例: external_chat）

### POST `/chat-ack-requests/:id/ack`
**Body**
- なし

**挙動**
- `requiredUserIds` に含まれるユーザのみ OK/確認できる
- 二重送信は冪等（同一ユーザは1回のみ記録される）

### POST `/chat-messages/:id/attachments`
**Body**
- `multipart/form-data` で `file` を送信

**挙動**
- `messageId` のメッセージに添付を追加する
- provider は `CHAT_ATTACHMENT_PROVIDER` に従う（`local`/`gdrive`）
- `CHAT_ATTACHMENT_MAX_BYTES` を超える場合は 413 を返す

### GET `/chat-attachments/:id`
**挙動**
- ERPの権限チェック（案件アクセス）を通過した場合のみダウンロード可能
- 認証はヘッダベースのため、UI側は `fetch` で取得してダウンロードする（直リンクではない）

### GET `/projects/:projectId/chat-unread`
**挙動**
- 自分の未読件数と `lastReadAt` を返す（他人の既読/未読は返さない）

### POST `/projects/:projectId/chat-read`
**挙動**
- 自分の `lastReadAt` を `now()` に更新する（MVPは「読み込み」時点で更新する運用）

### POST `/projects/:projectId/chat-summary`
**Body**
- `since` (任意: ISO日時)
- `until` (任意: ISO日時)
- `limit` (任意: 1〜200、デフォルト100)

**挙動**
- 直近メッセージを集計して「スタブ要約」を返す（外部LLM送信はしない）
- 実行操作は監査ログ `chat_summary_generated` として記録する

### POST `/chat-messages/:id/reactions`
**Body**
- `emoji` (1〜16文字)

**挙動**
- 同一ユーザの同一emojiは1回のみ加算
- 形式は `{ emoji: { count, userIds[] } }`
- 既存データが数値の場合は互換扱いで更新する

### 拡張API（案）
- `GET /chat-rooms`（参加可能なチャット一覧）
- `POST /chat-rooms`（新規作成/設定）
- `GET /chat-rooms/:id/messages`（メッセージ取得）
- `POST /chat-rooms/:id/messages`（メッセージ投稿）
- `POST /chat-rooms/:id/read`（既読更新）
- `GET /chat-rooms/:id/unread-counts`（未読件数）
- `POST /chat-messages/:id/attachments`（添付）
- `GET /chat-search?q=`（検索）
- `POST /chat-break-glass/requests`（監査閲覧申請）
- `POST /chat-break-glass/requests/:id/approve`（承認）
- `POST /chat-break-glass/requests/:id/reject`（却下）
- `GET /chat-break-glass/requests`（申請一覧/履歴）
- `GET /chat-break-glass/requests/:id/messages`（監査閲覧: メッセージ取得）

## UI（ProjectChat）
- プロジェクト選択、読み込み、投稿、タグ表示、リアクション
- タグ絞り込み入力（適用は「読み込み」ボタン）
- 追加読み込み（`before` 使用）
- 既定のリアクション候補: 👍/🎉/❤️/😂/🙏/👀

## UI（拡張方針）
- 未読/既読表示（設定に応じて表示方式を切替）
- メンション入力支援
- Markdownプレビュー
- 部門/全社/DM を含む「ルーム一覧」と作成・参加フロー
- 添付/検索/通知設定の導線（ルーム単位/個人単位）
- AI支援（要約/アクション抽出）表示の導線
- break-glass のバナー/履歴表示（ルーム単位）
- 監査者向けの申請/承認/閲覧UI（管理画面または監査画面）

## バリデーション/制約
- 本文: 1〜2000文字
- タグ: 最大8件、各32文字
- リアクションemoji: 1〜16文字

## テスト
- E2Eスモークに「投稿/リアクション」含む
  - `packages/frontend/e2e/frontend-smoke.spec.ts`

## 未実装/後続スコープ
- ルーム機能（部門/全社/DM/私的グループ）と管理者設定（DM無効化）
- メッセージ編集/削除（論理削除API）
- リアクションの取り消し（トグル）
- 添付の削除/論理削除API、ウイルス対策など
- リアルタイム更新（WS/ポーリング）
- 通知チャネル拡張（メール/Push/外部連携）
- 既読/未読の表示方式の切替/設定（既読者一覧/人数のみ/非表示 など）
- 検索（チャットのみ/ERP横断の切替）
- AI支援（要約/アクション抽出/FAQ/検索支援）
- 複数タグの AND/OR 検索

## 関連ドキュメント
- `docs/requirements/data-model-sketch.md`
- `docs/requirements/domain-api-draft.md`
- `docs/requirements/frontend-api-wire.md`
- `docs/requirements/rbac-matrix.md`
- `docs/requirements/access-control.md`
