# Payroll Rakuda Integration: Employee Master CSV Specification (Initial Repo-Based Draft)

Updated: 2026-03-15
Related issues: `#1436`, `#1430`, `#1433`, `#1434`, `#1435`, `#1439`, `#1442`

## Purpose

- Separate what can already be determined from the repository from what still depends on the actual Payroll Rakuda template and operational confirmation.
- Inventory which fields ERP4 can already provide, which fields require additional implementation, and which fields require fixed values or mapping values.

## Assumptions

- This document is an initial draft based on the repository state as of 2026-03-10.
- The target product is assumed to be `Kyuyo Rakuda Pro Version 26.00 Rev.10.31`.
- The product version is known, but the actual CSV column definition, encoding, and required columns remain pending and are tracked in `#1432`.
- CSV import into Payroll Rakuda is not used in the current operation.
- No explicit downloadable employee-master CSV template has been found in the product UI or the official site.
- The existing `GET /integrations/hr/exports/users` endpoint is an HR/ID integration export, not the payroll-specific CSV itself.
- `UserAccount.externalId` is reserved for IdP/SCIM and must not double as the payroll employee key.
- The initial `#1442` implementation adds canonical employee-master export, dispatch, and dispatch logs.

## Fields currently available in ERP4

### Existing sources

- `UserAccount`
  - `id`
  - `externalId`
  - `userName`
  - `displayName`
  - `givenName`
  - `familyName`
  - `active`
  - `emails`
  - `phoneNumbers`
  - `department`
  - `organization`
  - `managerUserId`
  - `createdAt`
  - `updatedAt`
- Existing export endpoint
  - `GET /integrations/hr/exports/users`
  - Supports `updatedSince`, `limit`, and `offset`

## Logical field definition (initial draft)

The actual CSV column names will be finalized after `#1432`. This section defines the logical fields on the ERP4 side.

| Logical field       | Intended use                   | ERP4 source                                          | Status          | Notes                                            |
| ------------------- | ------------------------------ | ---------------------------------------------------- | --------------- | ------------------------------------------------ |
| employeeCode        | Payroll-system employee key    | `UserAccount.employeeCode`                           | Available       | Added by `#1439` foundation work                 |
| loginId             | Secondary identifier           | `UserAccount.userName`                               | Available       | Not a primary key because login IDs may change   |
| externalIdentityId  | IdP/SCIM external identity     | `UserAccount.externalId`                             | Available       | Informational only                               |
| displayName         | Display name                   | `UserAccount.displayName`                            | Available       | Fallback rule is required when missing           |
| familyName          | Family name                    | `UserAccount.familyName`                             | Available       | No automatic split from `displayName` is planned |
| givenName           | Given name                     | `UserAccount.givenName`                              | Available       | Same as above                                    |
| activeFlag          | Active/inactive state          | `UserAccount.active`                                 | Available       | Current state, not termination date              |
| departmentName      | Department display name        | `UserAccount.department`                             | Conditional     | Name only; code is not implemented               |
| organizationName    | Organization display name      | `UserAccount.organization`                           | Conditional     | Code system not implemented                      |
| managerEmployeeCode | Manager employee code          | derived from `managerUserId`                         | Not implemented | Requires manager-to-employee-code conversion     |
| email               | Contact email                  | `UserAccount.emails`                                 | Conditional     | Primary-selection rule is required               |
| phone               | Contact phone                  | `UserAccount.phoneNumbers`                           | Conditional     | Primary-selection rule is required               |
| employmentType      | Employment classification      | `UserAccount.employmentType`                         | Available       | Added by `#1439` foundation work                 |
| title               | Job title                      | none                                                 | Not implemented | Payroll title vs display title needs design      |
| joinDate            | Hire date                      | `UserAccount.joinedAt`                               | Available       | Added by `#1439` foundation work                 |
| leaveDate           | Separation date                | `UserAccount.leftAt`                                 | Available       | Added by `#1439` foundation work                 |
| payrollGroup        | Payroll/closing scheme         | `EmployeePayrollProfile.payrollType` / `closingType` | Conditional     | Actual CSV mapping still needs confirmation      |
| defaultWorkMinutes  | Default scheduled work minutes | `LeaveSetting.defaultWorkdayMinutes`                 | Conditional     | Only global default exists today                 |
| bankAccount         | Payment account                | `EmployeePayrollProfile.bankInfo`                    | Conditional     | Granularity must be confirmed                    |
| note                | Free note                      | optional                                             | Undecided       | Prefer not to use unless required                |

## Initial classification of required, optional, and fixed-value fields

### Fields that can already be considered tentatively required within ERP4

- `loginId`
- `displayName` or `familyName` / `givenName`
- `activeFlag`

### Fields likely required for payroll operation but not yet fully implemented in ERP4

- `employeeCode`
- `employmentType`
- `joinDate`
- `payrollGroup`
- `departmentCode` or an equivalent organizational code required for payroll aggregation

### Optional candidates

- `email`
- `phone`
- `title`
- `managerEmployeeCode`

### Candidates that require fixed values or mapping values

- Active/inactive code values
- Employment-type codes
- Department or organization codes
- Payroll-group codes

## Output policy (initial draft)

### Output unit

- Full export is the initial default.
- The existing users export supports `updatedSince`, but whether Payroll Rakuda safely accepts differential master import is still unknown.

### Sort order

- Initial proposal: `employeeCode ASC`

### Encoding and line endings

- Internal canonical format: `UTF-8 + LF`
- Adapter output may convert to `Shift_JIS` / `CRLF` if required by the actual template.

## Current implementation baseline

- API
  - `GET /integrations/hr/exports/users/employee-master`
  - `POST /integrations/hr/exports/users/employee-master/dispatch`
  - `GET /integrations/hr/exports/users/employee-master/dispatch-logs`
- Canonical CSV header
  - `employeeCode`
  - `loginId`
  - `externalIdentityId`
  - `displayName`
  - `familyName`
  - `givenName`
  - `activeFlag`
  - `employmentType`
  - `joinDate`
  - `leaveDate`
  - `departmentName`
  - `organizationName`
  - `departmentCode`
  - `payrollType`
  - `closingType`
  - `paymentType`
  - `titleCode`
  - `email`
  - `phone`
- Initial validation
  - Missing `employeeCode` returns `409 employee_master_employee_code_missing`
- Dispatch behavior
  - Supports `idempotencyKey` replay / conflict / in-progress handling
  - Execution history is stored in `HrEmployeeMasterExportLog`

### Empty-value behavior

- Empty required columns stop the export.
- Optional columns are emitted as empty strings.
- Mapping failures stop the export and should be surfaced as `validation_*` or `mapping_*` failures.

## Initial ERP4-to-CSV mapping strategy

### Parts that can already be reused from the existing users export

| CSV logical column  | Current export value | Notes                               |
| ------------------- | -------------------- | ----------------------------------- |
| loginId             | `userName`           | Reusable as-is                      |
| displayName         | `displayName`        | Fallback rule needed when null      |
| familyName          | `familyName`         | Null handling must be confirmed     |
| givenName           | `givenName`          | Null handling must be confirmed     |
| activeFlag          | `active`             | May require code conversion         |
| departmentName      | `department`         | Name only; code mapping is separate |
| organizationName    | `organization`       | Same as above                       |
| managerEmployeeCode | `managerUserId`      | Requires employee-code conversion   |

### Master data that still needs dedicated implementation

| CSV logical column   | Recommended storage            | Reason                                       |
| -------------------- | ------------------------------ | -------------------------------------------- |
| employeeCode         | `UserAccount.employeeCode`     | Must be separated from `externalId`          |
| employmentType       | `UserAccount.employmentType`   | Core employee attribute                      |
| title                | dedicated employee profile     | Payroll-facing title needs explicit modeling |
| payrollGroup         | `EmployeePayrollProfile`       | Closing and payroll schemes belong here      |
| bankAccount          | `EmployeePayrollProfile`       | Sensitive information should be separated    |
| joinDate / leaveDate | `UserAccount.joinedAt/leftAt`  | Core employee attribute                      |
| departmentCode       | department/organization master | Display names are insufficient               |

## Test coverage considerations

### Positive cases

- An active employee is exported as one row.
- `displayName`, `familyName`, and `givenName` follow the documented fallback rule.
- `updatedSince` correctly narrows the candidate set.

### Negative cases

- Missing `employeeCode` stops the export.
- Missing required code mappings stop the export.
- A manager exists but cannot be converted to `managerEmployeeCode`.
- Multiple emails or phone numbers exist but no primary-selection rule resolves them.

### Audit requirements

- Full vs delta export mode
- Target row count
- Triggering operator
- Export conditions
- Missing-field list on failure

## Items that still require confirmation

The following cannot be finalized from the repository alone.

1. Actual Payroll Rakuda employee-master CSV columns, order, and required fields
2. `employeeCode` length, character set, and numbering rule
3. Actual code systems for title, employment type, payroll group, and closing type
4. Whether bank-account data should live in ERP4 or remain in another system of record
5. Whether differential export is accepted, or whether full export is always required
6. Whether active/inactive is sufficient, or whether hire and separation dates are mandatory

## Operational facts known today

- The current business process does not import employee-master CSV into Payroll Rakuda.
- Based on the operator's understanding, employee-ledger CSV import is possible, but the actual template has not been obtained.
- Therefore, the practical approach today is to first define what ERP4 can provide, then finalize the column-level contract after the template is collected.

## Current conclusion

- `#1436` can move forward as an ERP4-side source-field inventory, even before the real template is obtained.
- The first implementation scope for `#1442` is the canonical export, dispatch, and dispatch log for employee-master data.
- Final column names, code systems, and required-field rules still depend on `#1432`.
