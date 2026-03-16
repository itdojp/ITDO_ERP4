# ERP4 Management Accounting Report Requirements (Initial Draft)

Related issues: `#1446`, `#1430`, `#1433`, `#1434`, `#1435`, `#1439`, `#1440`, `#1441`

## Purpose

- Define the scope, users, aggregation axes, and update timing of the initial management-accounting reports on ERP4.
- Clarify the assumption that statutory accounting remains in the external accounting system, while ERP4 handles the fast internal values required for management decisions.
- Position the existing `project-profit`, `project-effort`, `overtime`, `delivery-due`, `burndown`, and `project-evm` implementations within the management-accounting context.

## Assumptions

- The primary specification for project profitability is `docs/requirements/profit-and-variance.md`.
- The baseline for automated delivery and report formatting is `docs/requirements/workflow-report-expansion.md`.
- Gaps related to payroll and accounting integrations are tracked in `docs/requirements/erp4-payroll-accounting-gap-analysis.md`.
- In the initial phase, ERP4 treats internally reproducible source data as its own system of record, while clearly labeling differences from statutory accounting as preliminary management values.
- The initial phase does not allocate company-wide overhead. Indirect costs are posted to shared or pseudo projects, and allocation rules are deferred to a later phase.

## Expected users

| User                    | Primary use                                                                   | Required granularity                                  | Already covered by existing implementation                   | Additional requirement                                   |
| ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| Executives              | Monthly sales, cost, gross profit, backlog, and loss-making project detection | Monthly, by department, by project                    | Project profit, overdue unbilled deliveries, effort variance | Department P/L, company-wide KPI dashboard               |
| Administration          | Reproducibility after close, periodic delivery, pre-accounting verification   | Monthly, by project, by employee, by delivery history | CSV/PDF delivery, project profit, overtime                   | Pre-payroll/accounting reconciliation, closing snapshots |
| PMs / operational leads | Project profitability, effort overrun, unbilled delivery checks               | By project, by user, by group, weekly/monthly         | Project profit, effort variance, burndown, EVM               | Dashboard navigation, role-based visibility              |

## Reports already available in ERP4

### Existing APIs / UI / delivery

| Area                        | API / screen                                      | Purpose                                                  | Main axes                         | Output           |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------- | --------------------------------- | ---------------- |
| Effort variance             | `GET /reports/project-effort/:projectId`          | Project-level effort and expense actuals                 | project, from, to                 | JSON / CSV / PDF |
| Project profitability       | `GET /reports/project-profit/:projectId`          | Sales, direct cost, gross profit                         | project, from, to                 | JSON / CSV / PDF |
| Profitability by user       | `GET /reports/project-profit/:projectId/by-user`  | User-level profitability via labor-cost-ratio allocation | project, userIds, from, to        | JSON / CSV / PDF |
| Profitability by group      | `GET /reports/project-profit/:projectId/by-group` | Profitability by user group                              | project, userIds, label, from, to | JSON / CSV / PDF |
| Group effort                | `GET /reports/group-effort`                       | Effort total for a user set                              | userIds, from, to                 | JSON / CSV / PDF |
| Overtime by user            | `GET /reports/overtime/:userId`                   | Individual effort totals and overtime view               | user, from, to                    | JSON / CSV / PDF |
| Overdue unbilled deliveries | `GET /reports/delivery-due`                       | Milestone-level unbilled delivery monitoring             | project, from, to                 | JSON / CSV / PDF |
| Burndown                    | `GET /reports/burndown/:projectId`                | Burn performance vs baseline                             | project, baseline, from, to       | JSON             |
| EVM                         | `GET /reports/project-evm/:projectId`             | PV / EV / AC / SPI / CPI                                 | project, from, to                 | JSON             |

### Current strengths

- ERP4 can already reproduce project-level sales, cost, effort, and gross profit from internal data alone.
- CSV/PDF output and scheduled delivery foundations already exist.
- For PM-facing profitability and effort control, the current implementation already forms a workable MVP baseline.

### Current gaps

- No authoritative department P/L source exists.
  - `department` exists on `UserAccount`, but it is not normalized as a reporting axis for revenue and cost.
- No authoritative payroll-cost source exists.
  - Current labor cost is `time_entries * rate_cards.unitPrice`, which is a management rate rather than confirmed payroll cost.
- There is no journal-level aggregation aligned to statutory accounting categories.
- There is no management-accounting snapshot that guarantees reproducibility after monthly close.
- Role-based dashboard requirements are not yet fully documented.

## Initial report list

### R1. Project profitability summary

- Purpose: confirm revenue, direct cost, gross profit, gross margin, and effort actuals by project.
- Users: executives, administration, PMs
- Aggregation axes:
  - project
  - from / to
- Data sources:
  - `Invoice`
  - `VendorInvoice`
  - `Expense`
  - `TimeEntry`
  - `RateCard`
- Update timing:
  - on-demand UI
  - monthly / weekly scheduled delivery
- Implementation status:
  - largely covered by existing `project-profit`
- Notes:
  - treated as preliminary management values
  - differences from statutory accounting are tolerated and reconciled on the external-accounting side

### R2. Project profitability drilldown (by user / by group)

- Purpose: identify why cost overruns occur and how profitability differs across assignees and teams.
- Users: executives, administration, PMs
- Aggregation axes:
  - project
  - user / user group
  - from / to
- Data sources:
  - `project-profit-by-user`
  - `project-profit-by-group`
- Update timing:
  - on-demand
  - monthly delivery
- Implementation status:
  - existing APIs are available
  - the Reports screen already exposes drilldown for by-user and by-group views
- Requirement notes:
  - `allocationMethod` must be displayed
  - the UI must explicitly state that the calculation uses labor-cost-ratio allocation

### R3. Department profit and loss

- Purpose: allow executives and administration to understand sales, cost, and gross profit by department.
- Users: executives, administration
- Aggregation axes:
  - department
  - month
  - optional project drilldown
- Initial data-source policy:
  - revenue: `Invoice.projectId -> Project`
  - direct cost: `VendorInvoice`, `Expense`, `TimeEntry`
  - department axis: initially use the project's owning department or responsible department as the primary candidate
- Implementation prerequisites:
  - normalized department-code rules and `project -> department` rules are required
  - depends on `#1434`, `#1439`, and `#1441`
- Phase:
  - requirements only in the initial phase
  - implementation comes later

### R4. Monthly KPI dashboard

- Purpose: show monthly management indicators in one place.
- Users: executives, administration
- Initial KPIs:
  - revenue actual
  - direct cost
  - gross profit
  - gross margin
  - overdue unbilled delivery count / amount
  - effort actuals
  - overtime
  - number of loss-making projects
- Aggregation granularity:
  - monthly
  - company / department / project
- Data sources:
  - R1, `delivery-due`, `group-effort`, `overtime`
- Implementation prerequisites:
  - reuse existing report APIs first
  - KPI card/dashboard layout is a separate issue
- Initial implementation:
  - `GET /reports/management-accounting/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `GET /reports/management-accounting/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv`
  - one API returns revenue, direct cost, gross profit, overdue unbilled values, overtime, and loss-making-project count from ERP4 internal data
  - when multiple currencies exist, top-level aggregated monetary KPI fields are omitted and `currencyBreakdown[]` is returned instead
  - CSV is flattened into three sections: `summary`, `currency_breakdown`, and `top_red_project`
  - the initial UI exposes a management-accounting summary card and CSV download under `Reports`, while project-level confirmation continues to use the existing `project-profit`

### R5. Pre-close reconciliation report for administration

- Purpose: verify closing-scope counts and unresolved items before payroll/accounting export.
- Users: administration
- Required checks:
  - unapproved expenses, vendor invoices, leave requests, and time entries in the target period
  - overdue unbilled deliveries
  - worklogs without rate cards
  - masters without external codes
- Implementation prerequisites:
  - depends on `#1433`, `#1434`, `#1435`, `#1439`, `#1440`, and `#1441`
- Phase:
  - requirements first
  - implementation later

## Aggregation axes and data-source definitions

### Revenue

- Initial definition: `Invoice.totalAmount`
- Inclusion rule: `status in (approved, sent, paid)`
- Period basis: `issueDate`
- Notes:
  - receipt-based accounting is out of scope in the initial phase
  - when multiple currencies are present, values are separated by currency and not aggregated into one top-level monetary figure

### Cost

- Outsourcing / purchases: `VendorInvoice.totalAmount`
- Direct expenses: `Expense.amount`
- Labor cost: `TimeEntry.minutes * RateCard.unitPrice`
- Notes:
  - labor cost is management-rate based, not payroll-confirmed cost
  - after payroll integration is complete, both payroll-confirmed labor cost and management-rate labor cost may coexist

### Department

- Initial requirement:
  - the authoritative department axis for reporting must come from a normalized department master with external-integration codes
  - free-text `UserAccount.department` must not be treated as the reporting system of record
- Dependencies:
  - `#1434` external code-system design
  - `#1439` HR/payroll prerequisite master data

### Project

- Initial requirement:
  - project profitability uses `Project.id` as the authoritative internal key
  - display and external references use `Project.code`

### Labor-cost allocation

- Initial policy:
  - project-level profitability keeps the existing `labor_cost` / `minutes` based allocation
  - department-level P/L requires a later allocation rule
- Initial operational handling:
  - shared labor cost is aggregated into shared/admin projects
  - redistribution from there is deferred to a later phase

## Update timing

- On-demand APIs:
  - project profitability
  - effort variance
  - burndown
  - EVM
- Scheduled delivery:
  - monthly project profitability, overdue unbilled deliveries, overtime, KPI summary
- Monthly close:
  - initially covered by `PeriodLock` plus operational evidence
  - a dedicated snapshot model is expected later

## Permission requirements

- Existing report APIs are limited to `admin` / `mgmt`
- Initial-phase direction:
  - company-wide KPI and department P/L remain limited to `admin`, `mgmt`
  - PM-only visibility for owned projects is desired, but still differs from current route design
- Conclusion:
  - record the requirement that PMs should only view their own projects, and treat implementation as a later task

## Initial KPI table

| KPI                       | Definition                                       | Existing source                               | Status                                        |
| ------------------------- | ------------------------------------------------ | --------------------------------------------- | --------------------------------------------- |
| Monthly revenue           | Sum of `Invoice.totalAmount` in the target month | `project-profit` aggregation logic            | partially reusable                            |
| Monthly direct cost       | `VendorInvoice + Expense + laborCost`            | `project-profit` aggregation logic            | partially reusable                            |
| Monthly gross profit      | revenue - direct cost                            | `project-profit` aggregation logic            | partially reusable                            |
| Gross margin              | gross profit / revenue                           | `project-profit` aggregation logic            | partially reusable                            |
| Effort actuals            | sum of `TimeEntry.minutes`                       | `project-effort`, `group-effort`              | implemented                                   |
| Overtime                  | total hours from `reportOvertime`                | `overtime`                                    | implemented, but definition may need revision |
| Overdue unbilled count    | count from `delivery-due`                        | `delivery-due`                                | implemented                                   |
| Loss-making project count | number of projects with gross profit < 0         | cross-project aggregation of `project-profit` | not implemented                               |

## Initial phase boundary

### Included in the initial implementation phase

- Project profitability and its delivery pipeline
- By-user and by-group profitability drilldown
- Effort variance, overdue unbilled deliveries, and overtime
- KPI requirement definition for the management-accounting dashboard

### Requirements-only items deferred to later implementation

- Department P/L
- Payroll-confirmed labor cost
- Journal-category aggregation
- Company-wide overhead allocation
- Monthly closing snapshots

## Links to subsequent issues

- `#1433`: gap analysis between ERP4 source data and required items
- `#1434`: external code-system design
- `#1435`: common integration specification
- `#1439`: HR/payroll prerequisite masters
- `#1440`: confirmed attendance data
- `#1441`: accounting events and journal conversion rules
- `#1447`: implementation of the initial reports defined here

## Repository-derived open issues

- Whether department P/L should use `Project`, `User`, or `Group` as the authoritative department anchor
- Whether labor cost should be displayed as management-rate based, payroll-confirmed, or both
- How PM-facing visibility should be split across routes, dashboards, and subscriptions
- Whether monthly reproducibility is sufficiently covered by `PeriodLock` alone or requires snapshots
- Whether the KPI dashboard should remain monthly only or later support weekly / quarterly views
