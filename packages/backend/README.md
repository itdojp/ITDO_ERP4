# ERP4 Backend PoC

## Setup
```
cd packages/backend
npm install
cp .env.example .env  # set DATABASE_URL
npx prisma generate
npm run dev
```

## API (PoC)
- health: GET /health
- auth mock: GET /me (x-user-id, x-roles headers)
- projects: GET/POST /projects
- estimates: POST /projects/:id/estimates, submit
- invoices: POST /projects/:id/invoices, submit, send
- purchase orders: POST /projects/:id/purchase-orders, submit, send
- vendor docs: POST /vendor-quotes, /vendor-invoices, approve
- time entries: GET/POST/PATCH /time-entries, submit
- expenses: GET/POST /expenses, submit
- leave: GET/POST /leave-requests
- daily reports & wellbeing: POST /daily-reports, /wellbeing-entries; GET wellbeing (HR only想定)
- alerts: GET /alerts, manual job: POST /jobs/alerts/run
- reports: GET /reports/project-effort, /reports/group-effort, /reports/overtime, /reports/delivery-due
- settings: alert-settings CRUD, approval-rules CRUD

## Notes
- Numbering: PYYYY-MM-NNNN per kind via number_sequences
- Auth/RBAC: header mock only; extend as needed
- Notifications/PDF: stub logging (MAIL_TRANSPORT=smtp でメール送信を有効化)
- Validation: TypeBox for some routes; expand as needed

## Email (SMTP)
- env:
  - MAIL_TRANSPORT=smtp
  - MAIL_FROM=from@example.com
  - SMTP_HOST / SMTP_PORT / SMTP_SECURE
  - SMTP_USER / SMTP_PASS (optional)
