# アラート通知方針（PoC stub → 後続実装）

## 現状
- channels: email, dashboard を stub で記録（sendEmailStub, buildStubResults）
- alerts.sentChannels/sentResult に stub を保存

## 次ステップ
- メール実装: 実SMTP/SendGrid等に切り替え、結果を sentResult に反映
- ダッシュボード: フロントで alerts をフェッチして表示（既存ダッシュボードを接続）
- 外部通知: Slack/Webhook チャネルを追加できる設計にする

## 仕様メモ
- AlertSetting: type (budget_overrun/overtime/approval_delay/delivery_due), threshold, scope, recipients (emails/roles/users), channels
- Alert: 発火時に status=open を保存、確認/クローズ操作は後続
- delivery_due: project_milestones.due_date を基準に未請求を検知

## 承認遅延アラートの運用ルール（初期）
- 判定対象: approval_instances が pending_* で、未完了の approval_steps を持つもの。
- 判定基準: 対象 step の createdAt から threshold 時間超過。parallelKey がある場合は同じ stepOrder 内で未完了が残っていれば遅延扱い。
- targetRef: `approval_instance:{id}:step:{stepOrder}` を使用し、同一 step の重複発火を抑止。
- 通知先: AlertSetting.recipients を優先。未設定の場合は approverGroupId / approverUserId を通知対象とする。
- クローズ条件: step が pending_* から non-pending に遷移した時点で close。次 step 開始時は新しい targetRef で判定。
- リマインド: 初期は再送なし。再送/エスカレーションは後続スコープ。
- 例外: 対象データが論理削除 or 申請取り下げの場合は判定対象から除外。

## バッチ/同期
- 日次で computeAndTrigger を実行。将来は時間単位に拡張
- 再送/サプレッションは未実装（後続）
