-- Demo seed data for PoC (projects, estimates, invoices, time, expenses)

insert into projects (id, code, name, status, created_at) values
  ('00000000-0000-0000-0000-000000000001','PRJ-DEMO-1','Demo Project 1','active', now()),
  ('00000000-0000-0000-0000-000000000002','PRJ-DEMO-2','Demo Project 2','active', now());

insert into estimates (id, project_id, version, total_amount, currency, status, created_at)
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',1,120000,'JPY','approved', now());

insert into invoices (id, project_id, estimate_id, invoice_no, issue_date, total_amount, currency, status, created_at)
values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','I2025-11-0001', now(),120000,'JPY','sent', now());

insert into time_entries (id, project_id, user_id, work_date, minutes, status, created_at)
values ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','demo-user', current_date, 120,'submitted', now());

insert into expenses (id, project_id, user_id, category, amount, currency, incurred_on, status, created_at)
values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','demo-user','travel',5000,'JPY', current_date,'approved', now());

