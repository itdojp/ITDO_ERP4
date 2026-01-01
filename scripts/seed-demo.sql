-- Demo seed data for PoC (tables use Prisma default PascalCase + camelCase columns)

insert into "Project" (id, code, name, status, "createdAt", "updatedAt") values
  ('00000000-0000-0000-0000-000000000001','PRJ-DEMO-1','Demo Project 1','active', now(), now()),
  ('00000000-0000-0000-0000-000000000002','PRJ-DEMO-2','Demo Project 2','active', now(), now())
on conflict do nothing;

insert into "Vendor" (id, code, name, status, "createdAt", "updatedAt") values
  ('00000000-0000-0000-0000-000000000010','VEND-DEMO-1','Demo Vendor 1','active', now(), now())
on conflict do nothing;

insert into "ApprovalRule" (id, "flowType", conditions, steps, "createdAt", "updatedAt") values
  ('50000000-0000-0000-0000-000000000001','estimate','{}','[]', now(), now()),
  ('50000000-0000-0000-0000-000000000002','invoice','{}','[]', now(), now()),
  ('50000000-0000-0000-0000-000000000003','expense','{}','[]', now(), now()),
  ('50000000-0000-0000-0000-000000000004','time','{}','[]', now(), now())
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
