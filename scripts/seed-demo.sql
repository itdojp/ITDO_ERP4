-- Demo seed data for PoC (tables use Prisma default PascalCase + camelCase columns)

insert into "Project" (id, code, name, status, "createdAt", "updatedAt") values
  ('00000000-0000-0000-0000-000000000001','PRJ-DEMO-1','Demo Project 1','active', now(), now()),
  ('00000000-0000-0000-0000-000000000002','PRJ-DEMO-2','Demo Project 2','active', now(), now())
on conflict do nothing;

insert into "Vendor" (id, code, name, status, "createdAt", "updatedAt") values
  ('00000000-0000-0000-0000-000000000010','VEND-DEMO-1','Demo Vendor 1','active', now(), now())
on conflict do nothing;

insert into "Customer" (id, code, name, status, "createdAt", "updatedAt") values
  ('00000000-0000-0000-0000-000000000020','CUST-DEMO-1','Demo Customer 1','active', now(), now())
on conflict do nothing;

insert into "UserAccount" (id, "userName", "displayName", "givenName", "familyName", department, active, "createdAt", "updatedAt") values
  ('90000000-0000-0000-0000-000000000001','e2e-member-1@example.com','E2E Member 1','E2E','Member 1','Engineering', true, now(), now()),
  ('90000000-0000-0000-0000-000000000002','e2e-member-2@example.com','E2E Member 2','E2E','Member 2','Sales', true, now(), now())
on conflict do nothing;

insert into "ApprovalRule" (id, "flowType", conditions, steps, "createdAt", "updatedAt") values
  ('50000000-0000-0000-0000-000000000001','estimate','{}','[]', now(), now()),
  ('50000000-0000-0000-0000-000000000002','invoice','{}','[]', now(), now()),
  ('50000000-0000-0000-0000-000000000003','expense','{}','[]', now(), now()),
  ('50000000-0000-0000-0000-000000000004','time','{}','[]', now(), now()),
  ('50000000-0000-0000-0000-000000000005','purchase_order','{}','[]', now(), now()),
  ('50000000-0000-0000-0000-000000000006','vendor_invoice','{}','[]', now(), now())
on conflict do nothing;

insert into "Estimate" (id, "projectId", version, "totalAmount", currency, status, "createdAt", "updatedAt")
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',1,120000,'JPY','approved', now(), now())
on conflict do nothing;

insert into "Invoice" (id, "projectId", "estimateId", "invoiceNo", "issueDate", "totalAmount", currency, status, "createdAt", "updatedAt")
values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','I2025-11-0001', now(),120000,'JPY','sent', now(), now())
on conflict do nothing;

insert into "TimeEntry" (id, "projectId", "userId", "workDate", minutes, status, "createdAt", "updatedAt")
values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','demo-user', current_date, 120,'submitted', now(), now())
on conflict do nothing;

insert into "Expense" (id, "projectId", "userId", category, amount, currency, "incurredOn", status, "createdAt", "updatedAt")
values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','demo-user','travel',5000,'JPY', current_date,'approved', now(), now())
on conflict do nothing;

insert into "PurchaseOrder" (id, "projectId", "vendorId", "poNo", "issueDate", "dueDate", currency, "totalAmount", status, "createdAt", "updatedAt")
values ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','PO2025-11-0001', current_date, current_date, 'JPY', 80000, 'draft', now(), now())
on conflict do nothing;

insert into "PurchaseOrderLine" (id, "purchaseOrderId", description, quantity, "unitPrice")
values ('61000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','Seed PO line', 1, 80000)
on conflict do nothing;

insert into "VendorQuote" (id, "projectId", "vendorId", "quoteNo", "issueDate", currency, "totalAmount", status, "createdAt", "updatedAt")
values ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','VQ-2025-11-0001', current_date, 'JPY', 90000, 'received', now(), now())
on conflict do nothing;

insert into "VendorInvoice" (id, "projectId", "vendorId", "vendorInvoiceNo", "receivedDate", "dueDate", currency, "totalAmount", status, "createdAt", "updatedAt")
values ('80000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','VI-2025-11-0001', current_date, current_date, 'JPY', 90000, 'received', now(), now())
on conflict do nothing;
