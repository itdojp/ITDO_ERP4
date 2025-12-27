# アラートのサプレッションとリマインド

このメモは、アラートのサプレッションとリマインドの初期設計をまとめる。

## サプレッションキー
- 同一条件の重複発報を避けるため、安定したキーを使う。
- キー: `(alert_setting_id, target_ref)`

## open アラートの挙動
- 同一キーの open アラートが存在する場合は新規作成しない。
- 代わりにリマインドのタイミングを判定する。

## リマインド
- AlertSetting に `remindAfterHours` を追加し、未設定なら再送なし。
- アラート作成時に `reminderAt` を記録（`remindAfterHours` が設定されている場合のみ）。
- open 状態かつ `now >= reminderAt` の場合に再送し、`reminderAt = now + remindAfterHours` に更新する。
- open 状態で `reminderAt` が未設定の場合は、再送せず `reminderAt` のみ設定する。

## クローズ条件
- メトリクスが閾値未満に戻った時点で close する。
- ダッシュボードから手動クローズを許容するかは後続検討。

## 監査
- リマインド送信結果は `sentResult` に追記する。
- アラート履歴はレポート用に保持する。
