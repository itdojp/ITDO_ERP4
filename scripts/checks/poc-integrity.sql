-- PoC integrity checks after loading scripts/seed-demo.sql
-- 1) counts
select count(*) as project_count from "Project";
select count(*) as estimate_count from "Estimate";
select count(*) as invoice_count from "Invoice";
select count(*) as time_entry_count from "TimeEntry";
select count(*) as expense_count from "Expense";
select count(*) as purchase_order_count from "PurchaseOrder";
select count(*) as vendor_quote_count from "VendorQuote";
select count(*) as vendor_invoice_count from "VendorInvoice";

-- 2) totals per project
select "projectId", sum("totalAmount") as invoice_total
from "Invoice"
group by "projectId"
order by "projectId";

select "projectId", sum(amount) as expense_total
from "Expense"
group by "projectId"
order by "projectId";

select "projectId", sum(minutes) as time_minutes
from "TimeEntry"
group by "projectId"
order by "projectId";

select "projectId", sum("totalAmount") as purchase_order_total
from "PurchaseOrder"
group by "projectId"
order by "projectId";

select "projectId", sum("totalAmount") as vendor_invoice_total
from "VendorInvoice"
group by "projectId"
order by "projectId";

-- 3) seed expectations (for scripts/seed-demo.sql)
-- project_count = 2
-- estimate_count = 1
-- invoice_count = 1
-- time_entry_count = 1
-- expense_count = 1
-- purchase_order_count = 1
-- vendor_quote_count = 1
-- vendor_invoice_count = 1
-- invoice_total(PRJ-DEMO-1) = 120000
-- expense_total(PRJ-DEMO-1) = 5000
-- time_minutes(PRJ-DEMO-1) = 120
-- purchase_order_total(PRJ-DEMO-1) = 80000
-- vendor_invoice_total(PRJ-DEMO-1) = 90000
