# フロント→バック API ワイヤ（PoC）

## auth
- GET `/me`
  - headers: `x-user-id`, `x-roles`
  - res: `{ user: { userId, roles } }`

## dashboard
- GET `/alerts` → ダッシュボード表示

## reports
- GET `/reports/delivery-due?from=YYYY-MM-DD&to=YYYY-MM-DD&projectId?`
- GET `/reports/project-effort/:projectId?from=YYYY-MM-DD&to=YYYY-MM-DD`
- GET `/reports/group-effort?userIds=a,b,c&from=YYYY-MM-DD&to=YYYY-MM-DD`
- GET `/reports/overtime/:userId?from=YYYY-MM-DD&to=YYYY-MM-DD`

## daily report / wellbeing
- POST `/daily-reports` { content, reportDate, linkedProjectIds?, status }
- POST `/wellbeing-entries` { entryDate, status, notes?, helpRequested?, notGoodTags?, visibilityGroupId }
- (人事向け) GET `/wellbeing-entries` → HRのみ

## time entries
- GET `/time-entries?projectId?&userId?`
- POST `/time-entries` { projectId, userId, workDate, minutes, taskId?, workType?, location?, notes? }
- PATCH `/time-entries/:id`
- POST `/time-entries/:id/submit`

## invoices / estimates
- GET `/projects/:projectId/estimates` (list)
- POST `/projects/:projectId/estimates` { lines, totalAmount, currency, validUntil?, notes }
- POST `/estimates/:id/submit`
- GET `/projects/:projectId/invoices` (list)
- POST `/projects/:projectId/invoices` { estimateId?, milestoneId?, lines, issueDate?, dueDate?, currency, totalAmount }
- POST `/invoices/:id/submit`
- POST `/invoices/:id/send` (stub)
- GET  `/alerts` (承認遅延/予算超過の表示用)

## purchase orders / vendor docs
- POST `/projects/:projectId/purchase-orders` { vendorId, lines, totals... }
- POST `/purchase-orders/:id/submit`
- POST `/purchase-orders/:id/send` (stub)
- POST `/vendor-quotes` { projectId, vendorId, quote_no?, ... }
- POST `/vendor-invoices` { projectId, vendorId, vendor_invoice_no?, ... }
- POST `/vendor-invoices/:id/approve`

## expenses
- GET `/expenses?projectId?&userId?`
- POST `/expenses` { projectId, userId, category, amount, currency?, incurredOn, isShared?, receiptUrl? }
- POST `/expenses/:id/submit`

## leave
- GET `/leave-requests?userId?`
- POST `/leave-requests` { userId, leaveType, startDate, endDate, hours?, notes }
- POST `/leave-requests/:id/submit`

## settings (admin/mgmt)
- GET/POST/PATCH `/alert-settings`, `/alert-settings/:id/enable|disable`
- GET/POST/PATCH `/approval-rules`
- POST `/approval-instances/:id/act` { action: approve|reject, reason? }
- POST `/jobs/alerts/run` (手動トリガー)

## role/permission policy (PoC)
- headers: `x-roles` = admin, mgmt, user, hr を想定
- HRのみ: `/wellbeing-entries` GET
- admin/mgmt: alert/approval設定
