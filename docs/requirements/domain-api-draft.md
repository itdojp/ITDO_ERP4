# ドメイン / データモデル / API ドラフト（MVP対象）

目的: スコープ合意 (#4) を実装に落とすためのエンティティ・関係・主要APIのたたき台。UUIDを内部IDとし、業務コードは別カラムで管理する。監査用に `created_at/by`, `updated_at/by`, 状態遷移ログを保持する。

## コアエンティティ概要
- **customers**: `id`, `code`, `name`, `invoice_registration_id`, `tax_region`, `billing_address`, `primary_contact_id`, `status`, `external_source/id`。
- **vendors**: `id`, `code`, `name`, `bank_info`, `tax_region`, `status`, `external_source/id`。
- **projects**: `id`, `code`, `name`, `status`, `project_type`, `parent_id`, `customer_id`, `owner_user_id`, `org_unit_id`, `start/end`, `currency`, `recurring_template_id`。
- **project_tasks**: `id`, `project_id`, `parent_task_id`, `name`, `wbs_code`, `assignee_id`, `status`, `plan_start/end`, `actual_start/end`, `baseline_id`。
- **project_milestones**: `id`, `project_id`, `name`, `amount`, `bill_upon`(date/acceptance/time), `due_date`, `tax_rate`, `invoice_template_id`。
- **recurring_project_templates**: `id`, `frequency`(monthly/quarterly/semiannual/annual), `default_amount`, `default_currency`, `default_tax_rate`, `default_terms`, `default_milestone_name`, `bill_upon`, `due_date_rule`(json), `should_generate_estimate`, `should_generate_invoice`, `next_run_at`, `timezone`, `is_active`。
- **estimates**: `id`, `project_id`, `version`, `total_amount`, `currency`, `status`(draft/pending_qa/pending_exec/approved/rejected), `valid_until`, `notes`。
- **invoices**: `id`, `project_id`, `estimate_id?`, `milestone_id?`, `invoice_no`, `issue_date`, `due_date`, `currency`, `total_amount`, `status`(draft/pending_qa/pending_exec/approved/sent/paid/cancelled), `pdf_url`, `email_message_id`。
- **billing_lines**: `id`, `invoice_id`, `description`, `quantity`, `unit_price`, `tax_rate`, `task_id?`, `time_entry_range?`。
- **purchase_orders**: `id`, `project_id`, `vendor_id`, `po_no`, `issue_date`, `due_date`, `currency`, `total_amount`, `status`(draft/pending_qa/pending_exec/approved/sent/acknowledged/cancelled), `pdf_url`。
- **purchase_order_lines**: `id`, `purchase_order_id`, `description`, `quantity`, `unit_price`, `tax_rate`, `task_id?`, `expense_id?`。
- **vendor_quotes**: `id`, `project_id`, `vendor_id`, `quote_no`, `issue_date`, `currency`, `total_amount`, `status`(received/approved/rejected), `document_url`。
- **vendor_invoices**: `id`, `project_id`, `vendor_id`, `vendor_invoice_no`, `received_date`, `due_date`, `currency`, `total_amount`, `status`(received/pending_qa/approved/paid/rejected), `document_url`。
- **time_entries**: `id`, `project_id`, `task_id?`, `user_id`, `work_date`, `minutes`, `work_type`, `location`, `notes`, `status`(draft/submitted/approved/rejected), `approved_by`, `approved_at`。
- **rate_cards**: `id`, `project_id?`, `role/work_type`, `unit_price`, `valid_from/to`, `currency`。
- **expenses**: `id`, `project_id`, `user_id`, `category`, `amount`, `currency`, `incurred_on`, `is_shared`(共通経費), `status`(draft/pending_qa/pending_exec/approved/rejected), `receipt_url?`。
- **leave_requests**: `id`, `user_id`, `leave_type`, `start_date`, `end_date`, `status`(draft/pending_manager/approved/rejected), `hours`, `notes`。
- **approval_rules**: `id`, `flow_type`(estimate/invoice/expense/leave/time), `conditions`(min/max amount, recurring flag), `steps`(ordered approver groups/users, allow_skip) stored as JSON。
- **alert_settings**: `id`, `type`(budget_overrun/overtime/approval_delay/approval_escalation/delivery_due), `threshold`, `period`, `recipients`(emails/roles/users/slackWebhooks/webhooks), `channels`(email,dashboard,slack,webhook), `remindAfterHours`。
- **doc_template_settings**: `id`, `kind`(estimate/invoice/purchase_order), `templateId`, `numberRule`, `layoutConfig`, `logoUrl`, `signatureText`, `isDefault`。
- **wellbeing_entries**: `id`, `user_id`, `entry_date`, `status`(good/not_good), `help_requested`, `notes?` (非必須), 閲覧は人事グループのみ。

## 関係メモ
- Project は Customer/Vendor と紐づき、Task/Milestone/Estimate/Invoice/Time/Expense を親として持つ。
- Recurring Template は Project に紐づき、生成時に Estimate/Invoice を起案。
- Approval Rules は flow_type + 条件でマッチングし Approval Instance を生成。状態遷移はログに保存。
- Alert Settings は各プロジェクトまたは全体スコープで有効化。通知先はメール+ダッシュボード（初期）。
- Template Settings は管理画面から CRUD。kind ごとに default を1件に保つ。
- Wellbeing は User と 1:n。閲覧は人事グループ限定。監査ログ必須。

## API I/O たたき台（REST想定）
- Project
  - `POST /projects` {code?, name, customer_id, parent_id?, start/end, type, currency}
  - `GET /projects/:id` /list with filters (customer, status, owner, hierarchy)
  - `PATCH /projects/:id` 更新
  - `POST /projects/:id/recurring-template` 作成/更新 {frequency, next_run_at, timezone, default_amount, default_currency, default_tax_rate, default_terms, default_milestone_name, bill_upon, due_date_rule, should_generate_estimate, should_generate_invoice, is_active}
- Task/Milestone
  - `POST /projects/:id/tasks` {parent_task_id?, name, assignee, dates, status}
  - `POST /projects/:id/milestones` {name, amount, bill_upon, due_date, tax_rate}
- Estimate/Invoice
  - `POST /projects/:id/estimates` {lines, total, valid_until}
  - `POST /estimates/:id/submit` → 承認フロー起動
  - `POST /projects/:id/invoices` {estimate_id?, milestone_id?, lines, issue_date, due_date}
  - `POST /invoices/:id/submit` → 承認フロー / `POST /invoices/:id/send` → PDF+メール
- Purchase Order
  - `POST /projects/:id/purchase-orders` {vendor_id, lines, issue_date, due_date}
  - `POST /purchase-orders/:id/submit` → 承認フロー / `POST /purchase-orders/:id/send` → PDF+メール or 送付ログ
  - `POST /purchase-orders/:id/acknowledge`（注文請書受領を記録）
- Vendor Docs
  - `POST /vendor-quotes` {project_id, vendor_id, quote_no?, total_amount, currency, issue_date, document_url}
  - `POST /vendor-invoices` {project_id, vendor_id, vendor_invoice_no?, total_amount, currency, received_date, due_date, document_url}
  - `POST /vendor-invoices/:id/approve` / `POST /vendor-invoices/:id/pay`
- Time
  - `POST /time-entries` {project_id, task_id?, work_date, minutes, work_type, location, notes}
  - `POST /time-entries/:id/submit` / `POST /time-entries/:id/approve`
  - `GET /reports/time` filters {user, group, project, period}
- Reports
  - `GET /reports/delivery-due` filters {from, to, project_id}
- Expense
  - `POST /expenses` {project_id, category, amount, currency, incurred_on, is_shared, receipt_url?}
  - `POST /expenses/:id/submit` / `POST /expenses/:id/approve`
- Leave
  - `POST /leave-requests` {leave_type, start_date, end_date, hours?, notes}
  - `POST /leave-requests/:id/submit` / `POST /leave-requests/:id/approve`
- Alerts
  - `POST /alert-settings` {type, threshold, period, recipients, channels}
  - `GET /alerts`（発報履歴）
- Wellbeing
  - `POST /wellbeing-entries` {entry_date, status, help_requested, notes?}
  - `GET /wellbeing-entries` (人事のみ)

## データモデルの注記
- ID: 全テーブル UUID（またはCUID）。人間可読コード（project_code, customer_code, invoice_no）は別管理。
- 監査: `created_at/by`, `updated_at/by`, 状態遷移ログ（who/when/from/to/reason）。
- 金額: 通貨は必須。税率は明示的に保持。インボイス番号は連番ポリシーを別途定義。
- 権限: RBAC + プロジェクトスコープ。Wellbeing は人事グループのみ閲覧。
- Recurring: frequency, next_run_at, due_date_rule, should_generate_* を保持し、スキップ/スライドは初期スコープ外。
- 性能: タイムシート月10万件想定。主要テーブルに period/user/project でインデックス。

## 番号体系（見積/納品/請求/仕入）
- 形式: `PYYYY-MM-NNNN`。P は Q=見積、D=納品、I=請求。YYYY は西暦、MM は月、NNNN は区分ごとの通し番号。
- 発番: 区分ごと・年月ごとに連番を管理する発番テーブルを持ち、楽観ロックで重複を防止する。
- 仕入関連: 発注書/注文請書/業者見積/業者請求も種別ごとに連番管理（例: POYYYY-MM-NNNN, VQYYYY-MM-NNNN, VIYYYY-MM-NNNN 等）。発番テーブルで重複防止し、番号を必須入力/自動採番の両対応とする。

## 次ステップ
- PRISMA/SQLスケッチで属性を具体化
- GraphQL 対応が必要な場合はクエリ/入力型を整理
- バッチ（定期案件生成、アラート計算）のジョブ仕様を追加
