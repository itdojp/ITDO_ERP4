# Payroll Rakuda Integration: Attendance CSV Specification (Initial Repo-Based Draft)

Updated: 2026-03-15
Related issues: `#1437`, `#1430`, `#1433`, `#1435`, `#1440`

## Purpose

- Clarify which data can already be reused for Payroll Rakuda attendance export and which monthly-closing and summary models are still required.
- Define the logical fields and responsibility boundaries under the policy that payroll CSV must be based on monthly confirmed attendance aggregates, not raw time-entry details.

## Assumptions

- The target product is assumed to be `Kyuyo Rakuda Pro Version 26.00 Rev.10.31`.
- The actual CSV template, encoding, and required fields are still unknown and depend on `#1431` and `#1432`.
- Payroll Rakuda attendance CSV import is not used in current operation.
- Operators understand that attendance-summary CSV import is possible, but the template has not been obtained.
- Based on official Q&A, using CSV attendance import may switch the product from traditional time cards to a simplified aggregate-only time-card mode.
- The current ERP4 export is only `GET /integrations/hr/exports/leaves`, which exports approved leave details.
- `TimeEntry` is a worklog/project-cost model, not a payroll-grade attendance system of record.
- Snapshot models required for monthly confirmation, versioned closing, and reproducible re-export were started as `AttendanceClosingPeriod` and `AttendanceMonthlySummary`.
- The first implementation phase provides `POST /integrations/hr/attendance/closings` and `GET /integrations/hr/attendance/closings*` for confirmed monthly snapshots.

## Current ERP4 source data

### Leave

- `LeaveRequest`
  - `userId`
  - `leaveType`
  - `startDate`
  - `endDate`
  - `hours`
  - `minutes`
  - `startTimeMinutes`
  - `endTimeMinutes`
  - `status`
  - `updatedAt`
- `LeaveType`
  - `code`
  - `name`
  - `unit`
  - `isPaid`
- Existing export
  - `GET /integrations/hr/exports/leaves?target=attendance|payroll`
  - `POST /integrations/hr/exports/leaves/dispatch`
  - `GET /integrations/hr/exports/leaves/dispatch-logs`

### Worklog / working-time evidence

- `TimeEntry`
  - `userId`
  - `projectId`
  - `workDate`
  - `minutes`
  - `workType`
  - `location`
  - `status`
  - `approvedBy`
  - `approvedAt`

### Leave setting and working-day configuration

- `LeaveSetting.defaultWorkdayMinutes`
- `LeaveGrant`, `LeaveCompGrant`, `LeaveCompConsumption`
- `WorkdayCalendar` routes

## What is still missing in ERP4

| Topic                                                    | Current state                                       | Status          | Notes                                                 |
| -------------------------------------------------------- | --------------------------------------------------- | --------------- | ----------------------------------------------------- |
| Monthly confirmed attendance table                       | none                                                | Not implemented | `#1440`                                               |
| Versioned monthly closing                                | none                                                | Not implemented | snapshot model required                               |
| Working-day count                                        | not stored                                          | Not implemented | cannot be derived safely from leave and worklog alone |
| Scheduled work minutes                                   | no per-person value                                 | Not implemented | only global default exists                            |
| Overtime buckets (statutory, extra, late-night, holiday) | absent                                              | Not implemented | `TimeEntry.minutes` alone is insufficient             |
| Late arrival / early leave / absence                     | absent                                              | Not implemented | requires actual attendance/timestamp model            |
| Closing state                                            | initial support in `AttendanceClosingPeriod.status` | Conditional     | `PeriodLock` integration is future work               |
| Monthly employee attendance summary                      | initial support in `AttendanceMonthlySummary`       | Conditional     | currently covers totals, not all buckets              |

## Logical field definition (initial draft)

| Logical field            | Intended meaning             | ERP4 source                                        | Status          | Notes                                                  |
| ------------------------ | ---------------------------- | -------------------------------------------------- | --------------- | ------------------------------------------------------ |
| employeeCode             | Employee key                 | none yet                                           | Not implemented | depends on the same employee-key foundation as `#1436` |
| closingMonth             | Target month                 | none yet                                           | Not implemented | requires closing model                                 |
| workingDays              | Number of worked days        | none                                               | Not implemented | no attendance-grade workday rule exists                |
| scheduledMinutes         | Scheduled work minutes       | `LeaveSetting.defaultWorkdayMinutes` as reference  | Conditional     | no per-person schedule yet                             |
| actualMinutes            | Actual work minutes          | derivable from `TimeEntry.minutes`                 | Conditional     | worklog-based, not attendance-grade                    |
| overtimeMinutes          | Overtime total               | existing overtime reporting has only simple totals | Conditional     | no statutory buckets yet                               |
| paidLeaveMinutes         | Paid leave consumed          | `LeaveRequest` + `LeaveType.isPaid`                | Available       | monthly confirmed aggregation still needed             |
| unpaidLeaveMinutes       | Unpaid leave consumed        | `LeaveRequest` + `LeaveType.isPaid=false`          | Available       | same as above                                          |
| compensatoryLeaveMinutes | Comp time / substitute leave | leave-type and comp-grant data                     | Conditional     | output classification still undecided                  |
| tardinessMinutes         | Late arrival                 | none                                               | Not implemented | requires attendance timestamps                         |
| earlyLeaveMinutes        | Early leave                  | none                                               | Not implemented | same as above                                          |
| absenceDays              | Absence days                 | none                                               | Not implemented | requires schedule vs actual comparison                 |
| note                     | Free note                    | `LeaveRequest.notes` exists                        | Conditional     | whether payroll CSV should carry this is unconfirmed   |

## Role of the existing leave export

### What is already possible

- Approved leave details can be exported with `attendance` or `payroll` targets.
- `GET /integrations/hr/exports/leaves` supports differential extraction with `updatedSince`, `limit`, and `offset`.
- `POST /integrations/hr/exports/leaves/dispatch` supports managed redispatch through `idempotencyKey` in the request body.
- The payload already includes `leaveTypeName`, `leaveTypeUnit`, `leaveTypeIsPaid`, and `requestedMinutes`.
- `POST /integrations/hr/attendance/closings` creates a period-based closing snapshot.
- `GET /integrations/hr/attendance/closings` and `GET /integrations/hr/attendance/closings/:id/summaries` expose the closed data.

### What the leave export still does not solve

- It is not a monthly confirmed employee summary.
- It does not include worked-day count, scheduled minutes, or overtime buckets.
- It does not provide closing month, closing version, or reproducible export lineage.
- The responsibility boundary between approved leave details and payroll-grade confirmed attendance is still separate.
- `AttendanceMonthlySummary` currently covers total overtime and paid/unpaid leave only; statutory buckets are not implemented.
- `AttendanceClosingPeriod` is dedicated to payroll-oriented snapshots and does not yet integrate with `PeriodLock`.

## Initial closing policy

### Principles

- Payroll CSV must be generated from monthly confirmed attendance values.
- Raw `TimeEntry` or `LeaveRequest` rows must not be exported directly to payroll CSV.
- In the initial implementation, closing is rejected if unapproved `TimeEntry` or `LeaveRequest` rows remain in the target month.

### Closing scope

- Active employees in the target month
- Approved leave
- Confirmed time/attendance values eligible for payroll calculation

### Recalculation and re-export

- If source data changes after closing, a new closing version must be created.
- Every CSV export must record which closing version it came from.
- The initial implementation adds a new version with `reclose=true` and marks the previous version as `superseded`.

## Initial ERP4-to-CSV mapping strategy

### Fields that can already be derived logically

| CSV logical field      | Current source                  | Condition                            |
| ---------------------- | ------------------------------- | ------------------------------------ |
| paidLeaveMinutes       | approved leave + `isPaid=true`  | monthly aggregation logic required   |
| unpaidLeaveMinutes     | approved leave + `isPaid=false` | same                                 |
| leaveBreakdown         | leave-type-based breakdown      | possible by extending leave export   |
| actualMinutesCandidate | sum of `TimeEntry.minutes`      | must be labeled as non-payroll-grade |

### Fields that cannot be produced from current data alone

| CSV logical field                    | Reason                                                |
| ------------------------------------ | ----------------------------------------------------- |
| workingDays                          | no authoritative workday rule exists                  |
| scheduledMinutes                     | no per-person work schedule exists                    |
| overtimeMinutesByType                | no statutory/late-night/holiday classification exists |
| tardinessMinutes / earlyLeaveMinutes | no attendance timestamps                              |
| absenceDays                          | no schedule-vs-actual gap calculation                 |
| closingMonth / closingVersion        | no finalized payroll export versioning model          |

## Initial rounding policy

- Internal canonical values use minutes.
- If the actual CSV requires hours, half-hours, or 10-minute units, conversion must happen in the output adapter.
- Rounding rules must be fixed when creating the monthly confirmed snapshot, not recalculated at CSV generation time.

## Initial error categories

### Export-stopping errors

- Target month is not closed
- Employee code is missing
- Required source data is missing for a closing target employee
- Required schedule / workday definition is missing

### Warning-level issues

- Leave exists but no corresponding time entry exists
- Time entries exist but do not align with approved leave
- Worklog-based `actualMinutes` diverges from the attendance system of record

## Test coverage considerations

### Positive cases

- One confirmed monthly row is generated per employee.
- Approved leave is aggregated separately into paid and unpaid leave minutes.
- Re-export reproduces the same closing version.

### Negative cases

- Export request for an unclosed month is rejected.
- Missing employee codes in closing targets cause export failure.
- Missing schedule-related values cause export failure.
- Re-export never silently shifts from one closing version to another.

## Items that still require confirmation

1. Actual Payroll Rakuda attendance CSV columns, order, and required fields
2. What exactly qualifies as a confirmed monthly value
   - approved worklogs
   - attendance-specific monthly closing
   - approved leave
3. Required overtime granularity
   - total overtime only
   - or statutory / extra / late-night / holiday buckets
4. Leave output granularity
   - paid/unpaid totals only
   - or leave-type-specific breakdowns
5. System of record for scheduled minutes
   - company default
   - employment-type-based
   - or person-specific
6. Whether `TimeEntry` should remain only an upstream source or be treated as part of confirmed attendance logic

## Current conclusion

- `#1437` can move forward only as a source-data and responsibility-boundary draft until the real payroll template is obtained.
- The `#1440` baseline now provides closing and summary foundations, but it is not yet a full payroll attendance model.
- The next material design decisions are the attendance source of truth, closing granularity, and overtime bucket rules.
