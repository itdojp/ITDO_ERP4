# 合意形成（フォーラム相当）の設計（MVP/未決定整理）

## 背景

旧システムでは承認前に投稿→返信で合意形成する導線がありました。ERP4ではチャットはあるものの、全員のOKトラッキング等は未実装です。

## 現状（ERP4）

- ルームチャット/メンション/既読
- break-glass/監査ログ
- 確認依頼（ack required）メッセージの作成/OK登録（実装済み、対象: ルームチャット）

## MVP実装（現状の仕様）

- 対象者は `requiredUserIds` / `requiredGroupIds` / `requiredRoles` で指定し、サーバ側でユーザIDへ展開して `requiredUserIds`（スナップショット）として保存する（展開後の最大は50人まで）
- `requiredGroupIds`: SCIM同期された `GroupAccount.displayName` を指定する（展開は `UserGroup` 経由）
- `requiredRoles`: `AUTH_GROUP_TO_ROLE_MAP` で解決される role code（例: `admin/mgmt/exec/hr`）を指定する（role → group → user に展開）
- 展開後の対象者に「無効/権限外」が含まれる場合は、対象者の指定を 400 で拒否する（通知の誤送/情報漏えいリスク低減のため）
- サーバ側で `requiredUserIds` の妥当性（active + 原則「ルーム閲覧可能」）を検証し、無効/権限外は 400 とする（`company` は暫定で active のみ検証）
- 期限は `dueAt` 任意（期限超過による自動クローズ/エスカレーションは未実装）
- OK取り消し（ack revoke）は実装済み（本人）
- 進捗表示はルーム参加者全員に表示（ack状況のみ表示し、既読/未読の区別はしない）
- 通知は `requiredUserIds` 向けに AppNotification（`kind=chat_ack_required`）を作成（メール配信は `NOTIFICATION_EMAIL_KINDS` に含めた場合のみ）。メンション通知（`kind=chat_mention`）は併用可

## #675 で確定する項目（確定）

### 1) 全員OK確認の投稿（ack required）

- MVPは現行実装（`requiredUserIds` による対象者指定 + ack進捗表示）を「合意形成」の基本機能として採用する
- 対象者指定の拡張（グループ/ロール指定、候補検索、上限値調整）は後続（通知/権限体系の確定後）

### 2) チャット/承認フローとの連携

- MVPでは「承認前の合意形成」と「正式な承認フロー」を分離し、相互参照はリンク/引用で行う（自動連携は後続）
- 後続で WorkflowDefinition/ActionPolicy（#717）と整合させ、actionKey から ack を要求できる形を検討する

### 3) 監査/ログ要件（誰が確認したか）

- MVPは「誰が/いつ ack したか」を検索可能にし、監査ログに残す（例: `ack_request_created` / `ack_added`）
- OK取り消し（ack revoke）、期限超過時の扱い（expired/リマインド/エスカレーション）は段階導入（MVPでは revoke/リマインドまで対応）

## 差分/課題

- OKトラッキング自体は実装済み。対象者指定は `requiredUserIds` に加え `requiredGroupIds` / `requiredRoles` に対応したが、候補検索（group/role の検索や展開結果の事前確認）は未整備
- （履歴）以前は `requiredUserIds` に対する通知がメンション依存だったが、現在は AppNotification（`kind=chat_ack_required`）による ack 専用通知を作成済み
- 期限超過/撤回/OK取り消し（ack revoke）などの運用と状態遷移が未確定
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

## 状態/期限（確定）

- Request 状態: open → closed（全員確認） / expired（期限超過） / canceled（撤回）
- 期限: dueAt を任意設定（未設定は期限なし）
- dueAt の意味: 「リマインド基準」に留め、自動クローズ/エスカレーションは行わない（後続で要件が固まれば拡張）

## 変更/撤回（確定/後続）

- 撤回（canceled）は実装済み（作成者/管理者）
- 回答の取り消し（ack revoke）は実装済み（本人）
- 監査上は履歴保存を必須とする（作成/ack はMVPで対応済み）

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

- [x] 対象者の指定方法（ユーザ/グループ/ロール）を追加（上限値の運用・候補検索・事前確認は後続）
- [x] dueAt のリマインド実装（期限超過時の通知ジョブ）
- [ ] 進捗の可視化範囲を確定（MVPはルーム内可視）
- [x] 撤回（canceled）を追加（作成者/管理者）
- [x] ack revoke を追加（本人）
- [ ] 外部ユーザ（external_chat）の対象者としての許容範囲を確定
- [ ] 承認フローとの連携方法（WorkflowDefinition/ActionPolicy と整合）を確定

## 関連

- `docs/requirements/project-chat.md`
- `docs/requirements/approval-log.md`
