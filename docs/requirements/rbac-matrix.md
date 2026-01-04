# RBAC マトリクス（PoC簡易版）

## ロール
- admin: 全ての設定・データ
- mgmt: 見積/請求/発注の承認・設定
- hr: ウェルビーイング閲覧（匿名集計/個人閲覧はルール別）
- user: 通常ユーザ（工数/日報/経費/休暇）

## リソース × 権限（PoC）
- projects: admin, mgmt（閲覧/作成）、user（閲覧）
- estimates/invoices: admin, mgmt（作成/承認/送信）、user（閲覧、自身プロジェクトのみ）
- purchase_orders/vendor_docs: admin, mgmt（作成/承認/送付）
- time_entries: user（自分）, mgmt/admin（全体）
- expenses: user（自分）, mgmt/admin（全体）
- leave_requests: user（自分）, mgmt/admin（全体）
- daily_reports: user（自分）
- wellbeing_entries: user（自分の登録）, hr（閲覧: 原則個人閲覧、匿名集計は5人以上）
- project_chat_messages: プロジェクトメンバー（user/mgmt/admin/hr）
- alert-settings / approval-rules: admin, mgmt
- approval-instances: admin/mgmt/exec + 申請者本人 + プロジェクトメンバー
- alerts: admin, mgmt（全体）、user（自分関連のみを将来考慮）

## 実装メモ（PoC）
- ヘッダ `x-roles` にロール列挙
- preHandler で requireRole() を利用（現状一部のみ適用）
- プロジェクトスコープ（projectId）での閲覧フィルタは段階導入中
  - 適用済み: projects, project_tasks, time_entries, expenses, estimates, invoices, approval_instances, project_chat_messages
  - 未適用: それ以外の一覧系API（後続タスクで拡充）
