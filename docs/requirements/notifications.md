# 通知体系（旧システム差分整理・たたき台）

## 目的
旧システムでメール運用されていた通知を、ERP4 で再現/最適化するためのイベント一覧とチャネル設計を整理する。

## 通知チャネル（現状実装）
- アプリ内: `AppNotification` + `/notifications`（既読/未読）
- メール: `AppNotificationDelivery` + `/jobs/notification-deliveries/run`
- Push: WebPush（`/push-notifications/test`、購読は `push_subscriptions`）
- 外部連携: Slack/Webhook（主にアラート系で利用、運用は allowlist）

## 通知イベント一覧（ドラフト）
### 日報/工数
- 日報未提出（対象: 本人 / 管理者）
- 日報提出（対象: 本人、必要なら上長）
- 日報修正（対象: 本人、必要なら上長）
- 工数修正の承認（対象: 申請者/承認者）

> 日報未提出の判定は `docs/requirements/daily-report-missing.md` を参照。

### 休暇
- 休暇申請の提出/差戻し/承認/却下（対象: 申請者/承認者）
- 休暇予定の事前通知（対象: 本人/管理者/必要ならチーム）

### プロジェクト
- 新規案件の作成（対象: 管理/マネージャ）
- ステータス変更（対象: 管理/マネージャ/リーダ）
- メンバー追加（対象: 追加されたユーザ）

### 承認フロー共通
- 申請作成/差戻し/承認/却下（対象: 申請者/承認者）
- 承認遅延（対象: 承認者/管理）※アラートとして実装済み

## チャネル別の初期方針（案）
- 重要: 承認、期限超過、日報未提出 → アプリ内 + メール
- 参考: 提出/修正通知 → アプリ内（メールは任意）
- 外部連携: アラート系のみ（Slack/Webhook）

## TODO
- 旧システムの運用ヒアリング結果を反映
- 受信者ルール（roles/groups/project members）の確定
- 通知サプレッションと再送ポリシーの確定
- 監査ログに残す通知イベントの範囲を決定

## 関連
- `docs/requirements/alerts-notify.md`
- `docs/requirements/approval-alerts.md`
- `docs/requirements/batch-jobs.md`
