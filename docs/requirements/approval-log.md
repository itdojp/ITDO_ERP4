# 承認ステップ監査ログ（ドラフト）

## audit_log テーブル案（共通）
- id, action, user_id, target_table, target_id, metadata, created_at
- metadata に from_status / to_status / reason / step_order / actor_group などを格納
- 参照用途: 監査・履歴確認。UI での表示は後続スコープ

## ログ項目
- instance_id, step_id, from_state, to_state
- acted_by, acted_at
- reason (任意)
- target_table, target_id (申請対象の参照)

## 実装方針
- approvalStep 更新時に logs テーブルへINSERT（または approval_steps に JSON logs フィールドを持つ）
- PoCでは change_log テーブルを作成するか、approval_steps に acted_by/acted_at/from/to/reason を保持

## 記録対象（MVP）
- 発番: action=number_sequence_allocated, metadata={kind, year, month, serial}
- 承認: action=approval_created/approval_approved/approval_rejected, metadata={from_status,to_status,step_order}
- Wellbeing閲覧: action=wellbeing_viewed, metadata={target_user_id, entry_date, viewer_role}

## 利用
- 申請の履歴表示（いつ誰が承認/却下したか）
- 監査用エクスポート
