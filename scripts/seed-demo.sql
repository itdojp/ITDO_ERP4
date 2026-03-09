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

insert into "ApprovalRule" (id, "flowType", "ruleKey", version, "isActive", "effectiveFrom", conditions, steps, "createdAt", "updatedAt", "createdBy") values
  ('50000000-0000-0000-0000-000000000001','estimate','system-default:estimate:low',1,true,'2000-01-01 00:00:00','{"amountMax":99999}','[{"approverGroupId":"mgmt","stepOrder":1}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000002','estimate','system-default:estimate:high',1,true,'2000-01-01 00:00:00','{"amountMin":100000}','[{"approverGroupId":"mgmt","stepOrder":1},{"approverGroupId":"exec","stepOrder":2}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000003','invoice','system-default:invoice:low',1,true,'2000-01-01 00:00:00','{"amountMax":99999}','[{"approverGroupId":"mgmt","stepOrder":1}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000004','invoice','system-default:invoice:high',1,true,'2000-01-01 00:00:00','{"amountMin":100000}','[{"approverGroupId":"mgmt","stepOrder":1},{"approverGroupId":"exec","stepOrder":2}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000005','expense','system-default:expense:low',1,true,'2000-01-01 00:00:00','{"amountMax":99999}','[{"approverGroupId":"mgmt","stepOrder":1}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000006','expense','system-default:expense:high',1,true,'2000-01-01 00:00:00','{"amountMin":100000}','[{"approverGroupId":"mgmt","stepOrder":1},{"approverGroupId":"exec","stepOrder":2}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000007','purchase_order','system-default:purchase_order:low',1,true,'2000-01-01 00:00:00','{"amountMax":99999}','[{"approverGroupId":"mgmt","stepOrder":1}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000008','purchase_order','system-default:purchase_order:high',1,true,'2000-01-01 00:00:00','{"amountMin":100000}','[{"approverGroupId":"mgmt","stepOrder":1},{"approverGroupId":"exec","stepOrder":2}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000009','vendor_invoice','system-default:vendor_invoice:low',1,true,'2000-01-01 00:00:00','{"amountMax":99999}','[{"approverGroupId":"mgmt","stepOrder":1}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000010','vendor_invoice','system-default:vendor_invoice:high',1,true,'2000-01-01 00:00:00','{"amountMin":100000}','[{"approverGroupId":"mgmt","stepOrder":1},{"approverGroupId":"exec","stepOrder":2}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000011','vendor_quote','system-default:vendor_quote:low',1,true,'2000-01-01 00:00:00','{"amountMax":99999}','[{"approverGroupId":"mgmt","stepOrder":1}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000012','vendor_quote','system-default:vendor_quote:high',1,true,'2000-01-01 00:00:00','{"amountMin":100000}','[{"approverGroupId":"mgmt","stepOrder":1},{"approverGroupId":"exec","stepOrder":2}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000013','leave','system-default:leave',1,true,'2000-01-01 00:00:00','{}','[{"approverGroupId":"mgmt","stepOrder":1}]', now(), now(), 'system'),
  ('50000000-0000-0000-0000-000000000014','time','system-default:time',1,true,'2000-01-01 00:00:00','{}','[{"approverGroupId":"mgmt","stepOrder":1}]', now(), now(), 'system')
on conflict do nothing;

insert into "ActionPolicy" (id, "flowType", "actionKey", priority, "isEnabled", subjects, "stateConstraints", "requireReason", guards, "createdAt", "updatedAt", "createdBy", "updatedBy") values
  ('52000000-0000-0000-0000-000000000001','estimate','submit',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000002','estimate','send',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000003','invoice','submit',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000004','invoice','send',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000005','invoice','mark_paid',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000006','expense','submit',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000007','expense','mark_paid',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000008','expense','unmark_paid',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000009','leave','submit',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000010','time','edit',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000011','time','submit',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000012','purchase_order','submit',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000013','purchase_order','send',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000014','vendor_invoice','update_allocations',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000015','vendor_invoice','update_lines',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000016','vendor_invoice','link_po',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000017','vendor_invoice','unlink_po',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000018','vendor_invoice','submit',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000019','estimate','approve',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000020','estimate','reject',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000021','invoice','approve',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000022','invoice','reject',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000023','expense','approve',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000024','expense','reject',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000025','leave','approve',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000026','leave','reject',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000027','time','approve',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000028','time','reject',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000029','purchase_order','approve',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000030','purchase_order','reject',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000031','vendor_invoice','approve',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000032','vendor_invoice','reject',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000033','vendor_quote','approve',0,true,null,null,false,null, now(), now(), 'system', 'system'),
  ('52000000-0000-0000-0000-000000000034','vendor_quote','reject',0,true,null,null,false,null, now(), now(), 'system', 'system')
on conflict do nothing;

insert into "Estimate" (id, "projectId", "estimateNo", version, "totalAmount", currency, status, "numberingSerial", "createdAt", "updatedAt")
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Q2025-11-0001',1,120000,'JPY','approved', 1, now(), now())
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
