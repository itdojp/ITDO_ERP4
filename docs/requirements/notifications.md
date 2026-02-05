# 通知体系（MVP確定）

## 目的

旧システムでメール運用されていた通知を、ERP4 で再現/最適化するためのイベント一覧とチャネル設計を整理する。

## 通知チャネル（現状実装）

- アプリ内: `AppNotification` + `/notifications`（既読/未読）
- メール: `AppNotificationDelivery` + `/jobs/notification-deliveries/run`
- Push: WebPush（`/push-notifications/test`、購読は `push_subscriptions`）
- 外部連携: Slack/Webhook（主にアラート系で利用、運用は allowlist）

## 通知設定（段階導入）

### ユーザ単位（通知量抑制）

- email:
  - `realtime` / `digest`（既定: digest）
  - `emailDigestIntervalMinutes`（既定: 10分）
- `digest` は通知配信ジョブ実行時に「まとめて配信」される
- web:
  - `muteAllUntil`（全体ミュートの期限）

### ルーム単位（チャット通知）

- `notifyAllPosts`: 全投稿通知の有無（既定: true）
- `notifyMentions`: メンション通知の有無（既定: true）
- `muteUntil`: ルーム単位ミュートの期限

※ これらの設定は DB に保持し、通知生成ロジックへ段階的に反映する。

## 現行実装（MVP）

※ 2026-01-24 時点（PR #681 で日報未提出通知を追加済み）

### 通知設定（段階導入）

- `UserNotificationPreference`（ユーザ単位）
  - `emailMode` / `emailDigestIntervalMinutes` / `muteAllUntil`
- `ChatRoomNotificationSetting`（ルーム×ユーザ）
  - `notifyAllPosts` / `notifyMentions` / `muteUntil`
- `chat_mention` は `notifyMentions` と `muteAllUntil` / `muteUntil` を尊重
  - project ルームは `roomId = projectId` として判定
- 非 project ルームは `mentionUserIds` に加えて `mentionGroupIds/@all` をルームの閲覧対象へ展開（project ルームは従来通り `mentionGroupIds/@all` 指定時に project members へ fallback）
- `chat_message`（全投稿通知）は `notifyAllPosts` と `muteAllUntil` / `muteUntil` を尊重
- それ以外の通知種別に対する抑制は後続で拡張

### AppNotification の発火イベント（実装済み）

- `chat_mention`: チャットのメンション通知（Chat で作成）
- `chat_message`: チャットの全投稿通知（Chat で作成）
- `chat_ack_required`: 確認依頼（ack required）の通知（requiredUserIds に対して作成）
- `chat_room_acl_mismatch`: ルームACL不整合の警告（owner/admin に対して作成、ジョブ）
- `daily_report_missing`: 日報未提出通知（ジョブで作成）
- `daily_report_submitted`: 日報提出（本人に対して作成）
- `daily_report_updated`: 日報修正（本人に対して作成）
- `project_created`: 案件作成（admin/mgmt に対して作成）
- `project_status_changed`: 案件ステータス変更（admin/mgmt/leader に対して作成）
- `project_member_added`: 案件メンバー追加（追加されたユーザに対して作成）
- `approval_pending`: 承認待ち通知（承認者に対して作成）
- `approval_approved`: 承認完了通知（申請者に対して作成）
- `approval_rejected`: 差戻し通知（申請者に対して作成）

### メール配信の対象（実装済み）

- `chat_mention`
- （任意）`chat_message`（環境変数 `NOTIFICATION_EMAIL_KINDS` に含めた場合）
- （任意）`chat_ack_required`（環境変数 `NOTIFICATION_EMAIL_KINDS` に含めた場合）
- （任意）`approval_pending`, `approval_approved`, `approval_rejected`（環境変数 `NOTIFICATION_EMAIL_KINDS` に含めた場合）
- `daily_report_missing`
- 配信ジョブ: `/jobs/notification-deliveries/run`

補足:

- `project_member_added` は現状 app-only（メール配信対象外）。
  - メール配信を行う場合は subject/body の生成ロジックを追加した上で `NOTIFICATION_EMAIL_KINDS` に含める。

### 未実装/手動のみ

- Push通知の実配信は `/push-notifications/test` の手動テストのみ
- イベント別のPush/外部連携（Slack/Webhook）は未実装

## 通知イベント一覧（MVP確定）

### 日報/工数

- 日報未提出（対象: 本人 / 管理者はアラートで通知）
- 日報提出（対象: 本人、必要なら上長）
- 日報修正（対象: 本人、必要なら上長）
- 工数修正の承認（対象: 申請者/承認者）

補足:

- 日報未提出は `kind=daily_report_missing` として AppNotification を生成（メール配信対象）。
- 旧システム（Project-Open）では `/intranet-timesheet2/hours/` から日報メール送信、および平日朝の未入力リマインダーメール（cron）運用があった（`docs/legacy/project-open-notes.md`）。

> 日報未提出の判定は `docs/requirements/daily-report-missing.md` を参照。

### 休暇

- 休暇申請の提出/差戻し/承認/却下（対象: 申請者/承認者）
- 休暇予定の事前通知（対象: 本人/管理者/必要ならチーム）

### 経費

- 経費精算の支払完了（対象: 申請者）

### プロジェクト

- 新規案件の作成（対象: 管理者/マネージャ）
- ステータス変更（対象: 管理者/マネージャ/リーダ）
- メンバー追加（対象: 追加されたユーザ）

### 承認フロー共通

- 申請作成/差戻し/承認/却下（対象: 申請者/承認者）
- 承認遅延（対象: 承認者/管理者）※アラートとして実装済み

## チャネル別の方針（MVP確定）

- 重要: 承認、期限超過、日報未提出 → アプリ内 + メール
- 参考: 提出/修正通知 → アプリ内（メールは任意）
- 外部連携: アラート系のみ（Slack/Webhook）

## 後続改定候補

- 旧システム運用ヒアリングの反映（必要に応じて改定）
- 追加イベント/チャネル（Push/外部連携）の拡張

## 具体化（MVP確定）

### イベント別の宛先/チャネル

| カテゴリ       | イベント                 | 宛先（MVP確定）                         | チャネル           | 備考                                                       |
| -------------- | ------------------------ | --------------------------------------- | ------------------ | ---------------------------------------------------------- |
| 日報/工数      | 日報未提出               | 本人 / 管理者(mgmt/admin, AlertSetting) | app + email        | 本人・管理者とも重要通知（管理者向けはアラート設定で制御） |
| 日報/工数      | 日報提出                 | 本人                                    | app                | メール不要（任意）                                         |
| 日報/工数      | 日報修正                 | 本人                                    | app                | ロック期間後の修正は管理者承認対象に寄せる                 |
| 日報/工数      | 工数修正申請/承認        | 申請者/承認者                           | app + email        | 承認系は重要通知扱い                                       |
| 合意形成       | 確認依頼（ack required） | requiredUserIds                         | app（emailは任意） | `kind=chat_ack_required`                                   |
| 休暇           | 申請/差戻し/承認/却下    | 申請者/承認者                           | app + email        | 承認系                                                     |
| 休暇           | 休暇予定の事前通知       | 本人 / 管理者                           | app                | メールは任意                                               |
| 経費           | 支払完了                 | 申請者                                  | app                | `kind=expense_mark_paid`（メールは任意）                   |
| プロジェクト   | 新規作成                 | mgmt/admin                              | app                | 既存ログと整合                                             |
| プロジェクト   | ステータス変更           | mgmt/admin/lead                         | app                | 重大変更のみメール（任意）                                 |
| プロジェクト   | メンバー追加             | 追加されたユーザ                        | app                | 参加通知                                                   |
| 承認（その他） | 申請/差戻し/承認/却下    | 申請者/承認者                           | app + email        | 重要通知                                                   |
| 承認           | 承認遅延                 | 承認者/管理者                           | app + email        | 既存アラートと整合                                         |

### 宛先ルール（MVP確定）

- `AppNotification.userId` は認証コンテキストの `userId` と同一（既定: JWTの `sub` / `email` / `preferred_username`、またはヘッダ `x-user-id`）。
- roles: admin/mgmt/exec/hr は Role による配信対象に含められる（role claim、および `groupIds` から派生して解決される）。
- groupIds: DB（`UserAccount`/`UserGroup`/`GroupAccount`）から解決する場合、`GroupAccount.displayName` の集合になる。
- `AUTH_GROUP_TO_ROLE_MAP`（例: `hr-group=hr`）により、group→role の変換を行う。
- project members: projectId 連動イベントは ProjectMember から宛先抽出
- 個別指定: recipients.users / recipients.emails を優先
- 補足: role 指定の宛先解決は AlertSetting 側で実装済み（role→group の逆引き + `UserAccount.userName` 解決）。AppNotification の汎用用途で必要になった場合は共通化を検討する。

### サプレッション/再送（MVP）

- remindAfterHours: 24h
- remindMaxCount: 3
- 同一イベントの再送は `AppNotificationDelivery` の status を参照して抑制

### 監査ログ対象（MVP）

- 通知マトリクスで「重要通知」に分類される承認系イベント（申請/承認/却下/差戻し）
  - 工数修正申請/承認
  - 休暇申請/承認/却下
- 承認遅延アラートの発火
- 日報未提出（生成）

## 関連

- `docs/requirements/alerts-notify.md`
- `docs/requirements/approval-alerts.md`
- `docs/requirements/batch-jobs.md`
