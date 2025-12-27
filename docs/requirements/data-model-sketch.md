# データモデル（SQL/Prismaスケッチ）ドラフト

目的: MVP範囲のエンティティをSQL/Prisma風に列挙し、型・主キー・主要インデックスを示す。UUID主キー、業務コードは別カラム。監査カラムは共通。

## 共通カラム
- `id uuid pk`
- `created_at timestamptz`, `created_by uuid`, `updated_at`, `updated_by`
- 状態遷移を持つテーブルは別途 change log（who/when/from/to/reason）を用意

## マスタ
- **customers**: code (unique), name, invoice_registration_id, tax_region, billing_address, primary_contact_id, status, external_source/id
  - idx: (code), (status)
- **vendors**: code (unique), name, bank_info, tax_region, status, external_source/id
- **contacts**: customer_id/vendor_id, name, email, phone, role, is_primary

## プロジェクト/タスク/マイルストーン
- **projects**: code (unique), name, status, project_type, parent_id, customer_id, owner_user_id, org_unit_id, start_date, end_date, currency, recurring_template_id
  - idx: (customer_id), (parent_id), (status)
- **project_tasks**: project_id, parent_task_id, name, wbs_code, assignee_id, status, plan_start/end, actual_start/end, baseline_id
  - idx: (project_id), (assignee_id), (status)
- **project_milestones**: project_id, name, amount, bill_upon (enum: date/acceptance/time), due_date, tax_rate, invoice_template_id
  - idx: (project_id), (due_date)
- **recurring_project_templates**: project_id, frequency (monthly/quarterly/semiannual/annual), default_amount, default_currency, default_tax_rate, default_terms, default_milestone_name, bill_upon, due_date_rule (json), should_generate_estimate, should_generate_invoice, next_run_at, timezone, is_active

## 見積/請求
- **estimates**: project_id, version, total_amount, currency, status (draft/pending_qa/pending_exec/approved/rejected), valid_until, notes, numbering_serial
  - idx: (project_id), (status)
- **invoices**: project_id, estimate_id?, milestone_id?, invoice_no (unique), issue_date, due_date, currency, total_amount, status (draft/pending_qa/pending_exec/approved/sent/paid/cancelled), pdf_url, email_message_id, numbering_serial
  - idx: (project_id), (status), (issue_date)
- **billing_lines**: invoice_id, description, quantity, unit_price, tax_rate, task_id?, time_entry_range?

### 番号発番
- **number_sequences**: kind (estimate/invoice/delivery/purchase_order/vendor_quote/vendor_invoice), year, month, current_serial, version
  - 形式: `PYYYY-MM-NNNN` (P=Q/D/I/PO/VQ/VI 等)。楽観ロックで重複防止。

## タイムシート/レート
- **time_entries**: project_id, task_id?, user_id, work_date, minutes, work_type, location, notes, status (submitted/approved/rejected), approved_by, approved_at
  - idx: (project_id, work_date), (user_id, work_date), (status)
- **rate_cards**: project_id?, role/work_type, unit_price, valid_from, valid_to, currency

## 経費/休暇
- **expenses**: project_id, user_id, category, amount, currency, incurred_on, is_shared, status (draft/pending_qa/pending_exec/approved/rejected), receipt_url?
  - idx: (project_id), (user_id, incurred_on), (status)
- **leave_requests**: user_id, leave_type, start_date, end_date, hours, status (draft/pending_manager/approved/rejected), notes
  - idx: (user_id, start_date), (status)

## 発注/仕入ドキュメント
- **purchase_orders**: project_id, vendor_id, po_no (unique), issue_date, due_date, currency, total_amount, status (draft/pending_qa/pending_exec/approved/sent/acknowledged/cancelled), pdf_url
  - idx: (project_id), (vendor_id), (status), (issue_date)
- **purchase_order_lines**: purchase_order_id, description, quantity, unit_price, tax_rate, task_id?, expense_id?
- **vendor_quotes**: project_id, vendor_id, quote_no, issue_date, currency, total_amount, status (received/approved/rejected), document_url
  - idx: (project_id), (vendor_id), (status)
- **vendor_invoices**: project_id, vendor_id, vendor_invoice_no, received_date, due_date, currency, total_amount, status (received/pending_qa/approved/paid/rejected), document_url
  - idx: (project_id), (vendor_id), (status), (due_date)

## 承認・アラート
- **approval_rules**: flow_type, conditions (JSON; min/max, recurring flag, project tags), steps (JSON; group/user order, allow_skip)
- **approval_instances**: flow_type, target_table/id, status, current_step, rule_id
- **approval_steps**: instance_id, step_order, approver_group_id?, approver_user_id?, status, acted_by, acted_at
  - idx: (instance_id), (status)
- **alert_settings**: type (budget_overrun/overtime/approval_delay/delivery_due), threshold, period, scope (global/project_id), recipients (emails/roles/users), channels (email/dashboard/ext_future), remind_after_hours, is_enabled
- **alerts**: setting_id, target_ref, triggered_at, reminder_at, status (open/ack/closed), sent_channels, sent_result

## 日報/ウェルビーイング
- **reports_daily** (日報): user_id, report_date, content, linked_project_ids?, status
- **wellbeing_entries**: user_id, entry_date, status (good/not_good), help_requested, notes?, visibility_group_id (人事グループ専用)
  - idx: (user_id, entry_date)

## 監査
- **change_logs**: table_name, record_id, from_state, to_state, reason, user_id, at

## インデックス指針
- タイムシート: (project_id, work_date), (user_id, work_date), (status)
- 請求/見積: (project_id, status), (issue_date)
- 経費/休暇: (project_id) + (user_id, incurred_on/start_date)
- アラート/承認: (status), (flow_type)

## 次ステップ
- Prisma/schema.sql に具体カラム型・enum を起こす
- 外部キー制約と on delete/ on update の方針を整理
- バッチ（定期案件生成、発番、アラート計算）のトリガとエラーハンドリングを追記
