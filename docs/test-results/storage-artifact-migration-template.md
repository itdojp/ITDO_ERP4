# Storage artifact migration evidence template

## Execution

- Date/time (UTC):
- Operator:
- Environment label (non-secret):
- Commit SHA:
- Image digest:
- Context: `pdf|evidence|evidence_metadata|report`
- Mode: `dry-run|apply`
- Private evidence reference:

Do not record credential values, Drive/folder IDs, VPS IP, absolute paths, personal information, or raw logs in this file.

## Result

| Item                     | Value                   |
| ------------------------ | ----------------------- |
| Status                   | `PASS / BLOCKED / FAIL` |
| Source count             |                         |
| Source bytes             |                         |
| Target verified count    |                         |
| Target verified bytes    |                         |
| Aggregate digest matched | `yes / no / not-run`    |
| Idempotent rerun         | `pass / fail / not-run` |

## Preconditions

- [ ] Target environment and operator approval were recorded.
- [ ] The DB migration was applied.
- [ ] Google Drive read/write preflight passed.
- [ ] Protected env/evidence files use mode `0600`.
- [ ] Runtime provider was not changed by the copy command.
- [ ] Source files were not deleted or modified.

## Blocker or failure

- Sanitized error code:
- Missing input/approval:
- Safe next action:
- Exact resume command (without secrets/identifiers):

## Rollback

- Provider setting before execution:
- Provider setting after execution:
- Rollback performed: `yes / no / not-needed`
- Confirmed no Drive permanent delete/source delete: `yes / no`
