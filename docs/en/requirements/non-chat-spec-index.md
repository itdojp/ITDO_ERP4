# Non-Chat Specification Index

Purpose: provide a single entry point for specifications outside chat features, including projects, estimates/invoices, time, expenses, approvals, reports, integrations, and operations.

## 1. Primary specifications (recommended reading order)

- Scope and overall shape: `docs/requirements/mvp-scope.md`
- Domain, data model, and API draft: `docs/requirements/domain-api-draft.md`
- Screens and operational flows (estimate / invoice / purchase / vendor invoice): `docs/requirements/estimate-invoice-po-ui.md`, `docs/requirements/delivery-invoice-flow.md`, `docs/requirements/vendor-doc-linking.md`, `docs/requirements/document-template-variants.md`
- Annotations and evidence: `docs/requirements/annotations.md`, `docs/requirements/workflow-evidence-pack.md`
- Approval, alerts, notifications, and ActionPolicy: `docs/requirements/approval-alerts.md`, `docs/requirements/approval-log.md`, `docs/requirements/alerts-notify.md`, `docs/requirements/alert-suppression.md`, `docs/requirements/notifications.md`, `docs/requirements/approval-ack-messages.md`, `docs/requirements/action-policy-high-risk-apis.md`, `docs/requirements/action-policy-failsafe-inventory.md`
- External integrations (payroll/accounting): `docs/requirements/erp4-payroll-accounting-gap-analysis.md`, `docs/requirements/external-code-system-design.md`, `docs/en/requirements/external-csv-integration-common-spec.md`, `docs/requirements/hr-crm-integration.md`, `docs/en/requirements/payroll-rakuda-employee-master-csv.md`, `docs/en/requirements/payroll-rakuda-attendance-csv.md`, `docs/en/requirements/accounting-ics-journal-csv.md`
- Spec/implementation alignment review (2026-02): `docs/requirements/spec-review-2026-02-10.md`
- Project, task, milestone, and recurring project operations:
  - `docs/requirements/project-task-milestone-flow.md`
  - `docs/requirements/recurring-project-template.md`
  - `docs/requirements/project-member-ops.md`
  - `docs/requirements/reassignment-policy.md`
- Time, expense, leave, daily report, and wellbeing:
  - API and core concepts: `docs/requirements/domain-api-draft.md`
  - Wellbeing: `docs/requirements/wellbeing-policy.md`
  - Expense settlement: `docs/requirements/expense-settlement.md`
  - Missing daily reports: `docs/requirements/daily-report-missing.md`
- Profitability, budget variance, and rate cards: `docs/requirements/profit-and-variance.md`, `docs/requirements/rate-card.md`
- Management accounting and executive reporting: `docs/en/requirements/management-accounting-report-requirements.md`
- Authentication, identity, and access control: `docs/requirements/id-management.md`, `docs/requirements/access-control.md`, `docs/requirements/rbac-matrix.md`
- Operations (backup, jobs, monitoring): `docs/requirements/backup-restore.md`, `docs/requirements/batch-jobs.md`, `docs/requirements/ops-monitoring.md`
- Data migration: `docs/requirements/migration-mapping.md`, `docs/requirements/migration-tool.md`, `docs/requirements/db-migration.md`, `docs/requirements/migration-poc.md`
- QA and test evidence: `docs/requirements/qa-plan.md`, `docs/manual/manual-test-checklist.md`, `docs/test-results/README.md`

Note: for chat features, the primary specifications are `docs/requirements/chat-rooms.md` and the room-integration supplements under `docs/requirements/project-chat.md`.

## 2. Confirmed decisions (summary)

- Time entries are recorded without approval by default; only significant edits go through approval flow.
- Expenses must always be attached to a project. Shared costs are handled through internal/admin projects.
- Invoices may be issued without estimates. Milestone linkage is optional. Unbilled overdue deliveries are handled by alerts and reports.
- Numbering uses `PYYYY-MM-NNNN` with per-kind, per-month sequences.
- Physical deletes are prohibited. Logical delete plus reason code is the default. Re-assignment and delete-like changes are blocked while approval is open.

## 3. Maintenance notes

- `docs/requirements/mvp-scope.md` is a summary document. For final approval and operational behavior, refer to `docs/requirements/approval-alerts.md`.
- Approval actions are standardized on `POST /approval-instances/:id/act`; dedicated per-resource `/approve` endpoints are not the target design.

## 4. Open checks (non-chat)

- Whether estimate numbers must be searchable and persisted as first-class identifiers.
- Whether invoice `dueDate` must be mandatory or warning-only.
- Ownership and permission model for payment/mark-paid operations, including partial payment handling.
- Period locking rules and how they align with `period_locks`.
- Production S3 values for backup (`bucket`, `region`, `KMS`) and migration timing.
