# Common Integration Specification for Payroll and Accounting CSV Exports

Updated: 2026-03-16
Related issues: `#1435`, `#1430`

## Purpose

- Define the shared operational rules for CSV integrations targeting Payroll Rakuda and Keiri Jokun Alpha.
- Standardize output units, redispatch behavior, auditability, and error handling before the individual adapter implementations are finalized.

## Assumptions

- Final column order, encoding, and required-field rules will be fixed after the actual templates are collected in `#1432`.
- This document is a common design draft aligned with the current `IntegrationRun`, `LeaveIntegrationExportLog`, and `AuditLog` implementations.

## 1. Scope

- Payroll Rakuda exports
  - employee master CSV
  - confirmed attendance CSV
- Keiri Jokun Alpha exports
  - journal CSV

## 2. Shared file-format principles

### 2.1 Encoding and delimiters

- Default canonical format
  - encoding: `UTF-8`
  - newline: `LF`
  - delimiter: `,`
  - header row: present
- Exceptions
  - If the actual product template requires `Shift_JIS` or `CRLF`, the adapter converts on output.
  - The canonical internal representation remains `UTF-8 + LF`.
- Implemented exception
  - The `#1443` ICS journal CSV is already exported as `CP932 + CRLF` to match the actual template.

### 2.2 Date, time, and numeric values

- Date
  - internal canonical: ISO 8601
  - output CSV: formatted as required by the target product, for example `YYYY/MM/DD`
- Time
  - Payroll exports should send confirmed monthly aggregates; timestamp-level details are auxiliary.
- Numeric values
  - Decimal handling, negative values, and rounding must be converted explicitly in the adapter.
  - Amounts must be represented in a way that allows machine validation of balance and totals.

## 3. Output units

### 3.1 Payroll exports

- Employee master
  - Full export is the initial default.
  - Differential export remains a later option.
- Attendance
  - Monthly-closing unit.
  - The confirmed monthly snapshot is the system of record.

### 3.2 Accounting exports

- Journal export
  - Output is scoped by target period or event set.
  - Each export must fix row count, total amount, and debit/credit balance.

## 4. Status design

### 4.1 Common export-job states

- `draft`
  - Export conditions are defined but no file has been generated.
- `exported`
  - File generation completed.
- `failed`
  - File generation failed.
- `replayed`
  - A repeated request reused a previous result under the same conditions.

### 4.2 Mapping to current implementation

- Existing `IntegrationRunStatus`
  - `running`, `success`, `failed`
- Existing leave dispatch
  - `LeaveIntegrationExportLog`
  - keeps `idempotencyKey`, `requestHash`, `reexportOfId`, `exportedUntil`, `exportedCount`
- Employee-master dispatch
  - `HrEmployeeMasterExportLog`
  - keeps `idempotencyKey`, `requestHash`, `reexportOfId`, `exportedUntil`, `exportedCount`
- ICS journal dispatch
  - `AccountingIcsExportLog`
  - keeps `idempotencyKey`, `requestHash`, `reexportOfId`, `periodKey`, `exportedUntil`, `exportedCount`
- Common operational references
  - `GET /integrations/jobs/exports`
    - cross-source list API for the three export-log families
    - the admin UI retrieves it from the `Settings` section with filters for kind, status, limit, and offset
  - `POST /integrations/jobs/exports/:kind/:id/redispatch`
    - re-exports a previously successful payload as a new log and tracks the source via `reexportOfId`
  - `GET /integrations/reconciliation/summary`
    - aggregate comparison of attendance closing, employee-master export, accounting ICS export, and journal staging by `periodKey`
  - `GET /integrations/reconciliation/details`
    - full employee-code differences for payroll, project/department breakdown for accounting, and sample rows for `pending_mapping`, `blocked`, and `invalid ready`

A future common job model should generalize these already implemented patterns.

## 5. Idempotency and redispatch

### 5.1 Idempotency keys

- Manual execution must carry `idempotencyKey`.
- Same `idempotencyKey` with the same conditions
  - may reuse the previous result.
- Same `idempotencyKey` with different conditions
  - must fail as `idempotency_conflict`.

### 5.2 Redispatch

- Redispatch keeps explicit linkage to the source job.
- Redispatch records must retain:
  - source job ID
  - operator
  - new idempotency key
  - payload version being re-exported
  - whether any material difference exists

## 6. Audit and history

### 6.1 Minimum recorded fields

- integration kind
- target period or closing key
- exported row count
- output file name
- operator
- execution timestamp
- source job of redispatch
- target job of redispatch
- status
- error code and message

### 6.2 Existing foundations

- `AuditLog`
- `IntegrationRun`
- `LeaveIntegrationExportLog`

### 6.3 Policy

- Each adapter should use audit event names that stay consistent with the existing `AuditLog` model.
- Where evidence tracking is required, links to `approvalInstanceId` and `EvidenceSnapshot` must remain possible.

## 7. Error policy

### 7.1 Errors that must stop export before file generation

- missing required codes
- unbalanced debit and credit
- period not closed
- missing counterparty or employee codes
- unmapped tax classification

### 7.2 Retryable errors

- temporary file-write failure
- external storage or notification failure

### 7.3 Error-code policy

- Business-rule errors and execution errors should stay separate:
  - `validation_*`
  - `mapping_*`
  - `idempotency_*`
  - `io_*`
  - `unexpected_*`

## 8. Permissions and approval

- Export operations are limited to administrative or operational-management roles.
- Production-equivalent resending should require a reasoned redispatch path.
- When approved data is exported, the integration jobs should stay cross-referenceable with approval and evidence artifacts.

## 9. Recommended implementation order at this stage

- Finalize per-adapter CSV columns in `#1436`, `#1437`, and `#1438`.
- Implement individual adapters in `#1442` and `#1443`.
- Implement common job management and redispatch in `#1444`.
- Implement reconciliation reports in `#1445`.

## 9.1 Initial implementation scope for `#1445`

- Start with the aggregate summary API only:
  - `GET /integrations/reconciliation/summary?periodKey=YYYY-MM`
- In the admin UI, the `Integration Reconciliation Summary` card in `Settings` fetches this by month.
- Initial comparison points:
  - attendance-closing summary count and total minutes
  - employee-code differences between full employee-master export and attendance closing
  - `ready / pending_mapping / blocked` counts in accounting journal staging
  - debit/credit balance flag for ready rows
  - row-count agreement between the latest ICS export and the ready staging rows
- The next step adds the detail API:
  - `GET /integrations/reconciliation/details?periodKey=YYYY-MM`
  - payroll: full employee-code difference list
  - accounting: project and department breakdown plus sample rows for `pending_mapping`, `blocked`, and `invalid ready`
- UI drilldown views are intentionally separated into a later phase.

## 10. Unresolved items

- Actual encoding, line-ending, and field-length constraints of Payroll Rakuda and Keiri Jokun Alpha templates
- How strictly a future common job table should model `draft/exported/imported/failed`
- Whether ERP4 should receive and store an explicit "import completed" acknowledgment from the external systems

## 11. Source files

- `packages/backend/src/routes/integrations.ts`
- `packages/backend/prisma/schema.prisma`
- `docs/requirements/hr-crm-integration.md`
- `docs/requirements/batch-jobs.md`
- `docs/requirements/pdf-email.md`
