-- Demo seed data for PoC (tables use Prisma default PascalCase + camelCase columns)

insert into "Project" (id, code, name, status, "createdAt") values
  ('00000000-0000-0000-0000-000000000001','PRJ-DEMO-1','Demo Project 1','active', now()),
  ('00000000-0000-0000-0000-000000000002','PRJ-DEMO-2','Demo Project 2','active', now());

insert into "Estimate" (id, "projectId", version, "totalAmount", currency, status, "createdAt")
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',1,120000,'JPY','approved', now());

insert into "Invoice" (id, "projectId", "estimateId", "invoiceNo", "issueDate", "totalAmount", currency, status, "createdAt")
values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','I2025-11-0001', now(),120000,'JPY','sent', now());

insert into "TimeEntry" (id, "projectId", "userId", "workDate", minutes, status, "createdAt")
values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','demo-user', current_date, 120,'submitted', now());

insert into "Expense" (id, "projectId", "userId", category, amount, currency, "incurredOn", status, "createdAt")
values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','demo-user','travel',5000,'JPY', current_date,'approved', now());
