# アラート通知方針（PoC stub → 後続実装）

## 現状
- channels: email は SMTP/SendGrid 設定があれば実送信、それ以外は stub（sendEmail / buildStubResults）
- channels: slack/webhook は `WEBHOOK_ALLOWED_HOSTS` を設定した場合のみ送信（未設定は skipped）
- alerts.sentChannels/sentResult に送信結果を保存

## 次ステップ
- 送信キュー/レート制御の設計・実装（メール/外部通知、必要なら）
- ダッシュボード: フロントで alerts をフェッチして表示（既存ダッシュボードを接続）
- 外部通知: Slack/Webhook の送信先登録・運用ルールの確定（allowlist/監査/失敗時運用）

## 外部Webhook送信（Slack/Webhook）設定
- デフォルト: 無効（`WEBHOOK_ALLOWED_HOSTS` 未設定）
- 有効化: `WEBHOOK_ALLOWED_HOSTS=hooks.slack.com,example.com`（ホスト名の完全一致）
- 制約:
  - `https://` のみ許可（`WEBHOOK_ALLOW_HTTP=true` を明示した場合のみ `http://` を許可）
  - プライベートIP（10/8, 192.168/16 等）への送信は拒否（`WEBHOOK_ALLOW_PRIVATE_IP=true` で無効化可）
  - タイムアウト: `WEBHOOK_TIMEOUT_MS`（未指定は 5000ms）
  - 最大ペイロード: `WEBHOOK_MAX_BYTES`（未指定は 1048576 bytes）
  - リダイレクト: follow しない（redirect はエラー扱い）

## 仕様メモ
- AlertSetting: type (budget_overrun/overtime/approval_delay/approval_escalation/delivery_due), threshold, scope, recipients (emails/roles/users/slackWebhooks/webhooks), channels
- Alert: 発火時に status=open を保存、確認/クローズ操作は後続
- delivery_due: project_milestones.due_date を基準に未請求を検知

## 承認遅延アラートの運用ルール（初期）
- 判定対象: approval_instances が pending_* で、未完了の approval_steps を持つもの。
- 判定基準: 対象 step の createdAt から threshold 時間超過。parallelKey がある場合は同じ stepOrder 内で未完了が残っていれば遅延扱い。
- targetRef: `approval_instance:{id}:step:{stepOrder}` を使用し、同一 step の重複発火を抑止。
- 通知先: AlertSetting.recipients を優先。未設定の場合は approverGroupId / approverUserId を通知対象とする。
- クローズ条件: step が pending_* から non-pending に遷移した時点で close。次 step 開始時は新しい targetRef で判定。
- リマインド: AlertSetting.remindAfterHours がある場合に reminderAt で再送。remindMaxCount で上限を制御（未設定は 3 回）。
- 例外: 対象データが論理削除 or 申請取り下げの場合は判定対象から除外。

## 承認期限エスカレーション（バッチ）
- 判定対象: approval_steps の currentStep が pending_* のもの。
- 判定基準: step の createdAt から threshold 時間超過。
- targetRef: `approval_instance:{id}:step:{stepOrder}` を使用。

## バッチ/同期
- 日次で computeAndTrigger を実行。将来は時間単位に拡張
- 再送/サプレッションは remindAfterHours + remindMaxCount で制御する（Slack/Webhook は allowlist 設定時のみ送信）
