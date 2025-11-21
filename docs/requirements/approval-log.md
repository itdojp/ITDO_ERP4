# 承認ステップ監査ログ（ドラフト）

## ログ項目
- instance_id, step_id, from_state, to_state
- acted_by, acted_at
- reason (任意)
- target_table, target_id (申請対象の参照)

## 実装方針
- approvalStep 更新時に logs テーブルへINSERT（または approval_steps に JSON logs フィールドを持つ）
- PoCでは change_log テーブルを作成するか、approval_steps に acted_by/acted_at/from/to/reason を保持

## 利用
- 申請の履歴表示（いつ誰が承認/却下したか）
- 監査用エクスポート
