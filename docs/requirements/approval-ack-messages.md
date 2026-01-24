# 合意形成（フォーラム相当）の設計（たたき台）

## 背景
旧システムでは承認前に投稿→返信で合意形成する導線がありました。ERP4ではチャットはあるものの、全員のOKトラッキング等は未実装です。

## 現状（ERP4）
- ルームチャット/メンション/既読
- break-glass/監査ログ

## 差分/課題
- 「指定メンバー全員のOKを確認できる投稿」がない
- 承認フローとチャットの連携が未整理

## 目的/スコープ
- 目的: 承認前の「合意形成」をチャット内でトラッキングし、対象者の確認状況を可視化する
- 非対象: 正式な承認フローの代替ではない（承認フローは別途）
- 対象: ルームチャット内の投稿（公式/私的/DMは要件確定後）

## 方針案（未確定）
- チャットに「ack required」メッセージ種別を追加
- 返信とは別に「確認済み」アクションを持たせる
- 監査ログに ack の履歴を残す
- 対象者は「ユーザ指定」を基本にし、必要ならグループ/ロール指定に拡張

## 状態/期限（案）
- Request 状態: open → closed（全員確認） / expired（期限超過） / canceled（撤回）
- 期限: dueAt を任意設定（未設定は期限なし）
- 期限超過時の挙動: 分かりません（通知のみ/自動クローズ/エスカレーション）

## 変更/撤回（案）
- 作成者は撤回可能（canceled）とする
- 回答の取り消し（ack revoke）は要判断（未確定）
- 監査上は履歴保存を必須とする

## UI/UX（案）
- メッセージに「ack必須」バッジと進捗（例: 3/5）を表示
- 対象者は「確認」ボタンで ack する
- 進捗表示範囲は要決定（全員公開/作成者のみ）
- 未完了一覧の簡易ビュー（期限順）を追加

## 通知（案）
- 作成時に対象者へ通知
- 期限前リマインド（例: 24h/1h）を任意設定
- 完了時は作成者へ通知
- チャネルは `docs/requirements/notifications.md` の方針に従う

## 監査/ログ（案）
- 監査ログ: ack_request_created / ack_request_acknowledged / ack_canceled / ack_expired
- metadata に room_id / message_id / required_user_ids / due_at / actor を記録

## データモデル（案）
- 既存（ルームチャット用）: `ChatAckRequest(messageId, roomId, requiredUserIds, dueAt)`
- 既存（ルームチャット用）: `ChatAck(requestId, userId, ackedAt)`
- 廃止済み（レガシー・プロジェクトチャット用）: `ProjectChatAckRequest` / `ProjectChatAck`
  - migration `20260112030000_drop_legacy_project_chat` で削除
- 拡張案:
  - ChatAckRequest: status / canceledAt / canceledBy / targetType / targetIds / snapshotUserIds

## 権限（案）
- 作成: ルーム投稿権限を持つユーザ
- 変更/撤回: 作成者 + ルーム管理者
- 外部ユーザ `external_chat` の扱いは分かりません

## TODO
- [ ] 対象者の指定方法（ユーザのみ/グループ/ロール）を確定
- [ ] 期限超過時の扱いを確定
- [ ] 進捗の可視化範囲を確定
- [ ] 撤回/再確認の許容範囲を確定
- [ ] 外部ユーザ（external_chat）の対象者としての許容範囲を確定
- [ ] 監査ログ/検索/通知との接続を整理

## 関連
- `docs/requirements/project-chat.md`
- `docs/requirements/approval-log.md`
