# 合意形成（ack required）の仕様（MVP確定）

## 背景

旧システムでは「承認を取りたい内容を投稿し、返信/確認で合意形成する」導線がありました。ERP4 ではチャット上で確認必須（ack required）を付与し、対象者の確認状況（OK）をトラッキングします。

## 概要（現行実装）

- チャット発言に「確認必須（ack required）」を設定し、対象者の ack をトラッキングする
- 対象者は user/group/role で指定でき、サーバ側で `requiredUserIds` に展開して保存する（スナップショット）
  - 指定方法のスナップショットとして `requestedUserIds` / `requestedGroupIds` / `requestedRoles` も保存する
- 期限（任意）: `dueAt`
  - 期限超過は UI 上で可視化される（自動クローズはしない）
  - 期限超過後のリマインド通知ジョブを提供する
  - （任意）エスカレーション（通知強化）を提供する
- 取消/撤回:
  - 撤回（canceled）: 作成者/管理者
  - ack 取り消し（ack revoke）: 本人
- 通知: `requiredUserIds` 向けに AppNotification を作成（メールは運用設定により段階導入）

## データモデル（実装）

- `ChatMessage`: 発言本体
- `ChatAckRequest`: ack required の要求（`messageId` で 1:1）
  - `requiredUserIds`（展開後スナップショット）
  - `requestedUserIds` / `requestedGroupIds` / `requestedRoles`（指定方法スナップショット）
  - `dueAt`（任意）
  - `remindIntervalHours`（任意）
  - `escalationAfterHours` / `escalationUserIds` / `escalationGroupIds` / `escalationRoles`（任意）
  - `canceledAt` / `canceledBy`
- `ChatAck`: ack の記録（`requestId` + `userId` のユニーク）
- `ChatAckLink`: 業務データとの参照リンク（例: `approval_instances`）
- `ChatAckTemplate`: `flowType` + `actionKey` 単位のテンプレ（自動作成・期限・エスカレーション等）

## 対象者指定と検証（実装）

- 対象者は `requiredUserIds` / `requiredGroupIds` / `requiredRoles` で指定する
  - `requiredUserIds`: 直接 userId を指定
  - `requiredGroupIds`: SCIM 同期された `GroupAccount.displayName` を指定（展開は `UserGroup` 経由）
  - `requiredRoles`: `AUTH_GROUP_TO_ROLE_MAP` で解決される role code（例: `admin/mgmt/exec/hr`）を指定（role→group→user に展開）
- 展開後の対象者に「無効/権限外」が含まれる場合は 400 で拒否する（通知の誤送/情報漏えいリスク低減）
- 受信者検証（room ACL）:
  - 原則「ルーム閲覧可能」であること（viewer/poster + メンバーシップ）を検証する
  - `company` ルームは `viewerGroupIds` が設定されている場合はその範囲に制限し、未設定の場合は active ユーザを許可する
- 上限値（対象者数など）は chat settings（システム設定）で運用する

## 期限/リマインド/エスカレーション（実装）

- 期限（`dueAt`）は任意。期限超過（`dueAt < now` かつ未完了）は UI 上で「期限超過」として表示する
- 自動クローズはしない（未完了は未完了のまま）
- リマインド（ジョブ）: `/jobs/chat-ack-reminders/run`
  - `dueAt` 経過後の未完了 request を抽出し、未ackユーザへ `kind=chat_ack_required` の AppNotification を追加生成する
  - 抑止: `CHAT_ACK_REMINDER_MIN_INTERVAL_HOURS`（既定 24h）内の同一 `messageId` への再通知を抑止する
- エスカレーション（任意）:
  - `escalationAfterHours` が設定されている場合、`dueAt + escalationAfterHours` 経過時に `kind=chat_ack_escalation` の AppNotification を生成する
  - 宛先は `escalationUserIds/groupIds/roles` を展開して決定する

## 通知（実装）

- 作成時: 対象者へ `kind=chat_ack_required` を作成
- リマインド: 未ack者へ追加で `kind=chat_ack_required` を作成
- エスカレーション: 指定宛先へ `kind=chat_ack_escalation` を作成
- メール配信は `NOTIFICATION_EMAIL_KINDS` とユーザ設定（`realtime/digest`、既定 10 分）に従う
- 通知抑制（全体ミュート/ルームミュート/全投稿/メンション）は `docs/requirements/notifications.md` を参照

## 業務ワークフローとの連携（実装）

詳細は `docs/requirements/ack-workflow-linking.md` を参照。

- 参照リンク（Phase 1）: `ChatAckLink` を作成し、業務詳細/承認UI等から該当発言へ遷移できる
- Guard（Phase 2）: ActionPolicy の guard `chat_ack_completed` により、未完了の場合は業務アクションを拒否できる
  - `dueAt` 超過かつ未完了は `expired` として扱い、ガードは失敗する
  - admin/mgmt は理由必須で例外実行でき、監査ログに記録される
- テンプレ（Phase 3）: `ChatAckTemplate` により `flowType/actionKey` 起点で ack required を自動作成できる

## 関連

- `docs/requirements/notifications.md`
- `docs/requirements/ack-workflow-linking.md`
- `docs/manual/chat-guide.md`
