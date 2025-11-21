# アラート通知方針（PoC stub → 後続実装）

## 現状
- channels: email, dashboard を stub で記録（sendEmailStub, buildStubResults）
- alerts.sentChannels/sentResult に stub を保存

## 次ステップ
- メール実装: 実SMTP/SendGrid等に切り替え、結果を sentResult に反映
- ダッシュボード: フロントで alerts をフェッチして表示（既存ダッシュボードを接続）
- 外部通知: Slack/Webhook チャネルを追加できる設計にする

## 仕様メモ
- AlertSetting: type (budget_overrun/overtime/approval_delay), threshold, scope, recipients (emails/roles/users), channels
- Alert: 発火時に status=open を保存、確認/クローズ操作は後続

## バッチ/同期
- 日次で computeAndTrigger を実行。将来は時間単位に拡張
- 再送/サプレッションは未実装（後続）
