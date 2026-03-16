# Keiri Jokun Alpha Pro II Integration: ICS Journal CSV Specification (Initial Repo-Based Draft)

Updated: 2026-03-16
Related issues: `#1438`, `#1430`, `#1433`, `#1434`, `#1435`, `#1441`, `#1443`

## Purpose

- Organize the initial ICS journal CSV specification exported from ERP4 to Keiri Jokun Alpha Pro II based on the actual template file and current operational feedback.
- Separate the fields that ERP4 can already supply, the fields that require additional mapping masters, and the import rules that remain unconfirmed.
- Fix the baseline implementation contract as of 2026-03-16 for the API and dispatch logs that export `AccountingJournalStaging.status=ready` rows to ICS CSV.

## Implemented baseline

- `GET /integrations/accounting/exports/journals`
  - Returns canonical JSON.
- `GET /integrations/accounting/exports/journals?format=csv`
  - Returns ICS CSV encoded as `CP932 + CRLF`.
- `POST /integrations/accounting/exports/journals/dispatch`
  - Persists the export result with `idempotencyKey`.
- `GET /integrations/accounting/exports/journals/dispatch-logs`
  - Returns dispatch history.

### Export target

- Only rows with `AccountingJournalStaging.status='ready'` are exported.
- If `pending_mapping` or `blocked` rows remain in the same scope, export stops with `409 accounting_journal_mapping_incomplete`.
- Even for ready rows, export stops with `409 accounting_journal_ready_row_incomplete` when any of the following is missing:
  - `debitAccountCode`
  - `creditAccountCode`
  - `taxCode`
  - positive `amount`

### Scope

- The current baseline filters only by `periodKey`.
- When `periodKey` is omitted, all periods are included in scope.
- `periodKey` must be in `YYYY-MM` format; invalid values return `400 invalid_period_key`.

## Assumptions

- Based on user input, the target product is `Keiri Jokun Alpha Pro II Version 26.002`.
- The local file `21期_表形式入力フォーマット（ICS取込用）.CSV` is treated as the actual template.
- For review and implementation reference, the repository also includes `docs/requirements/samples/21ki_ics_journal_header_sample.csv`, which contains only the header row.
- Operational feedback indicates that the fields commonly entered during normal imports are:
  - Date
  - Debit code / credit code
  - Debit name / credit name
  - Amount
  - Description
- The actual template also contains additional columns such as department, branch, tax classification, and journal classification.

## Actual template inspection result

Target file: `21期_表形式入力フォーマット（ICS取込用）.CSV`

### File format

- Encoding: judged to be `CP932 / Shift_JIS`
- BOM: none
- Newlines: `CRLF`
- Lines 1-4: title, company information, target period
- Line 5: header row
- Data rows: none
- The repository keeps `docs/requirements/samples/21ki_ics_journal_header_sample.csv` as a UTF-8 restatement of the header row for review and implementation reference.
- The runtime export converts to `CP932 + CRLF` to match the actual template.

### Header columns (30 columns)

1. Date
2. Closing/adjustment flag
3. Voucher number
4. Department code
5. Debit code
6. Debit name
7. Debit branch
8. Debit branch description
9. Debit branch kana
10. Credit code
11. Credit name
12. Credit branch
13. Credit branch description
14. Credit branch kana
15. Amount
16. Description
17. Tax classification
18. Consideration
19. Purchase classification
20. Sales industry classification
21. Journal classification
22. Dummy1
23. Dummy2
24. Dummy3
25. Dummy4
26. Dummy5
27. Bill number
28. Bill due date
29. Sticky note number
30. Sticky note comment

## Primary fields used in current operation

Operator feedback states that the following fields are commonly used in day-to-day imports.

- `Date`
- `Debit code`
- `Credit code`
- `Debit name`
- `Credit name`
- `Amount`
- `Description`

For the initial implementation, those fields are treated as the primary required candidates, while the remaining columns are categorized as fixed-value, empty-value, or pending confirmation.

## Logical field definition (initial draft)

| CSV column                    | Intended use                         | Candidate ERP4 source                                  | Status          | Notes                                                       |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------ | --------------- | ----------------------------------------------------------- |
| Date                          | Journal date                         | document date / posting date                           | Conditional     | The actual source date must be defined per accounting event |
| Closing/adjustment flag       | Closing or correction classification | fixed-value candidate                                  | Unconfirmed     | The default value for ordinary imports must be confirmed    |
| Voucher number                | Voucher identifier                   | ERP4-derived sequence                                  | Not implemented | Derivation from document numbers is a strong candidate      |
| Department code               | Department axis                      | project/customer/vendor/employee derived code          | Not implemented | Depends on `#1434`                                          |
| Debit code                    | Debit GL account                     | accounting mapping master                              | Not implemented | Depends on `#1441`                                          |
| Debit name                    | Debit account name                   | mapping master or fixed name                           | Not implemented | Prefer to manage together with the code                     |
| Debit branch                  | Debit subaccount                     | accounting mapping master                              | Not implemented | Must confirm whether optional or required                   |
| Debit branch description      | Debit subaccount description         | project/customer/vendor name, etc.                     | Conditional     | Actual use is unconfirmed                                   |
| Debit branch kana             | Debit subaccount kana                | stored in master                                       | Not implemented | ERP4 does not keep this today                               |
| Credit code                   | Credit GL account                    | accounting mapping master                              | Not implemented | Depends on `#1441`                                          |
| Credit name                   | Credit account name                  | mapping master or fixed name                           | Not implemented | Same as above                                               |
| Credit branch                 | Credit subaccount                    | accounting mapping master                              | Not implemented | Same as above                                               |
| Credit branch description     | Credit subaccount description        | project/customer/vendor name, etc.                     | Conditional     | Actual use is unconfirmed                                   |
| Credit branch kana            | Credit subaccount kana               | stored in master                                       | Not implemented | ERP4 does not keep this today                               |
| Amount                        | Journal amount                       | document amount / line amount                          | Conditional     | The balancing unit must be defined                          |
| Description                   | Journal description                  | document number, project name, counterparty name, etc. | Conditional     | Character limit is unconfirmed                              |
| Tax classification            | Tax code                             | mapped from `taxRate`                                  | Not implemented | Depends on `#1434` and `#1441`                              |
| Consideration                 | Invoice/tax basis                    | gross or net amount                                    | Unconfirmed     | Must confirm whether used                                   |
| Purchase classification       | Purchase category                    | mapping                                                | Unconfirmed     | Requiredness must be confirmed                              |
| Sales industry classification | Sales category                       | mapping                                                | Unconfirmed     | May only apply to sales-side entries                        |
| Journal classification        | Journal type                         | fixed value or mapping                                 | Unconfirmed     | Requiredness must be confirmed                              |
| Dummy1-5                      | Reserved fields                      | fixed empty values                                     | Conditional     | Meaning in the template is unconfirmed                      |
| Bill number                   | Bill information                     | none                                                   | Not implemented | Candidate to remain outside the initial scope               |
| Bill due date                 | Bill information                     | none                                                   | Not implemented | Same as above                                               |
| Sticky note number            | Memo                                 | none                                                   | Not implemented | Candidate to remain outside the initial scope               |
| Sticky note comment           | Memo                                 | none                                                   | Not implemented | Candidate to remain outside the initial scope               |

## Initial view of required columns

### Currently primary required candidates

- `Date`
- `Debit code`
- `Credit code`
- `Debit name`
- `Credit name`
- `Amount`
- `Description`

### Conditional required candidates

- `Department code`
- `Tax classification`
- `Journal classification`
- `Debit branch` / `Credit branch`

### Initial fixed-value or empty-value candidates

- `Closing/adjustment flag`
- `Dummy1` to `Dummy5`
- `Bill number`
- `Bill due date`
- `Sticky note number`
- `Sticky note comment`

## Initial ERP4 event-to-journal conversion policy

### Expected events

- Expense approval
- Vendor invoice approval
- Invoice approval
- Future extension for payment and receipt operations

### Conversion policy

- One document does not necessarily equal one voucher.
- The design must allow expansion into multiple journal rows per detail line or allocation unit.
- ERP4 creates accounting-event staging first, then converts it into ICS CSV.
- As of 2026-03-16, the baseline creates `AccountingEvent` and `AccountingJournalStaging` when approvals for `expenses`, `invoices`, and `vendor_invoices` complete, and keeps unresolved rows as `pending_mapping` or `blocked`.
- The `#1443` baseline converts only staging rows that have already become `ready`.

### Minimum mapping required

- Document type -> debit / credit GL account
- project / department -> department code
- vendor / customer / project -> branch candidates
- tax rate -> tax classification

## Initial output-unit policy

- One voucher = one logical voucher.
- A voucher may contain multiple detail lines.
- The leading candidate is to output one CSV row as one debit/credit pair.
- When multiple debit/credit rows belong to the same voucher, they share the same voucher number.

## Initial error classification

### Export-stopping errors

- Missing debit or credit account code
- Missing department code
- Unmapped tax classification
- Unbalanced debit and credit
- Zero amount or negative amount that violates the business rule
- `pending_mapping` or `blocked` rows remain in the export scope

### Warnings

- Name columns do not match the mapping master
- Description approaches the character limit
- Initial out-of-scope columns are emitted as empty values

## Test considerations (initial draft)

### Positive cases

- CSV is generated with the same 30 columns as the current template.
- It is encoded as `CP932 + CRLF`.
- A sample using only the primary operational fields can be generated.
- Multiple detail lines can share the same voucher number.

### Negative cases

- Failure on missing debit or credit code
- Failure on missing department code
- Failure on unmapped tax classification
- Failure on unbalanced debit/credit
- Undefined behavior when text exceeds the character limit

## Items that still require confirmation

1. Default value for `Closing/adjustment flag`
2. Official numbering rule for `Voucher number`
3. Whether `Department code` is required in actual operation
4. Requiredness and code systems for `Tax classification`, `Consideration`, `Purchase classification`, `Sales industry classification`, and `Journal classification`
5. Whether `Debit name` / `Credit name` must match the code-defined name or can be free auxiliary text
6. Actual requiredness of `Debit branch` / `Credit branch`
7. Character limit of `Description`
8. Whether `CP932 + CRLF` is mandatory in actual operation

## Current conclusion

- `#1438` can move beyond simple inventory because the actual template is now available.
- The baseline implementation for `#1443` already provides ICS CSV export, dispatch, and dispatch-log APIs.
- At this stage, however, only the template columns and the primary operational fields are confirmed; requiredness, fixed values, and code systems are still open.
- The next practical decisions are the closing/adjustment flag, department code, tax classification, branch handling, and description constraints.
- Even after the baseline implementation, `#1434` and `#1441` must still finalize mapping masters, export validation rules, and CSV conversion rules.

## Source files

- `21期_表形式入力フォーマット（ICS取込用）.CSV`
- `docs/requirements/erp4-payroll-accounting-gap-analysis.md`
