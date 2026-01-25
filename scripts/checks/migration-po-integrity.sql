-- PO migration integrity checks (generic)
-- - Intended to be run after `scripts/migrate-po.ts --apply`
-- - Expected: mismatch queries should return 0 rows

-- 1) counts
select count(*) as customer_count from "Customer";
select count(*) as vendor_count from "Vendor";
select count(*) as project_count from "Project";
select count(*) as task_count from "ProjectTask";
select count(*) as milestone_count from "ProjectMilestone";
select count(*) as estimate_count from "Estimate";
select count(*) as invoice_count from "Invoice";
select count(*) as purchase_order_count from "PurchaseOrder";
select count(*) as vendor_quote_count from "VendorQuote";
select count(*) as vendor_invoice_count from "VendorInvoice";
select count(*) as time_entry_count from "TimeEntry";
select count(*) as expense_count from "Expense";

-- 2) totals per project
select "projectId", sum("totalAmount") as invoice_total
from "Invoice"
group by "projectId"
order by "projectId";

-- 2.5) user references (should be resolved via UserAccount.id)
select e.id, e."userId"
from "Expense" e
left join "UserAccount" u on u.id = e."userId"
where u.id is null;

select te.id, te."userId"
from "TimeEntry" te
left join "UserAccount" u on u.id = te."userId"
where u.id is null;

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

select "projectId", sum("totalAmount") as vendor_quote_total
from "VendorQuote"
group by "projectId"
order by "projectId";

select "projectId", sum("totalAmount") as vendor_invoice_total
from "VendorInvoice"
group by "projectId"
order by "projectId";

-- 3) referential integrity (cross-project mismatches)
-- Invoice.estimateId -> Estimate.projectId mismatch
select i.id, i."invoiceNo", i."projectId" as invoice_project_id, e."projectId" as estimate_project_id
from "Invoice" i
join "Estimate" e on e.id = i."estimateId"
where i."estimateId" is not null
  and i."projectId" <> e."projectId";

-- Invoice.milestoneId -> ProjectMilestone.projectId mismatch
select i.id, i."invoiceNo", i."projectId" as invoice_project_id, m."projectId" as milestone_project_id
from "Invoice" i
join "ProjectMilestone" m on m.id = i."milestoneId"
where i."milestoneId" is not null
  and i."projectId" <> m."projectId";

-- PurchaseOrderLine.expenseId -> Expense.projectId mismatch
select pol.id, po."poNo", po."projectId" as po_project_id, e."projectId" as expense_project_id, pol."expenseId"
from "PurchaseOrderLine" pol
join "PurchaseOrder" po on po.id = pol."purchaseOrderId"
join "Expense" e on e.id = pol."expenseId"
where pol."expenseId" is not null
  and po."projectId" <> e."projectId";

-- TimeEntry.taskId -> ProjectTask.projectId mismatch
select te.id, te."projectId" as time_project_id, t."projectId" as task_project_id, te."taskId"
from "TimeEntry" te
join "ProjectTask" t on t.id = te."taskId"
where te."taskId" is not null
  and te."projectId" <> t."projectId";

-- BillingLine.taskId -> Invoice.projectId mismatch
select bl.id, i."invoiceNo", i."projectId" as invoice_project_id, t."projectId" as task_project_id, bl."taskId"
from "BillingLine" bl
join "Invoice" i on i.id = bl."invoiceId"
join "ProjectTask" t on t.id = bl."taskId"
where bl."taskId" is not null
  and i."projectId" <> t."projectId";

-- EstimateLine.taskId -> Estimate.projectId mismatch
select el.id, e."estimateNo", e."projectId" as estimate_project_id, t."projectId" as task_project_id, el."taskId"
from "EstimateLine" el
join "Estimate" e on e.id = el."estimateId"
join "ProjectTask" t on t.id = el."taskId"
where el."taskId" is not null
  and e."projectId" <> t."projectId";

-- PurchaseOrderLine.taskId -> PurchaseOrder.projectId mismatch
select pol.id, po."poNo", po."projectId" as po_project_id, t."projectId" as task_project_id, pol."taskId"
from "PurchaseOrderLine" pol
join "PurchaseOrder" po on po.id = pol."purchaseOrderId"
join "ProjectTask" t on t.id = pol."taskId"
where pol."taskId" is not null
  and po."projectId" <> t."projectId";

-- 4) line totals vs header totals (abs(diff) > 0.01)
select e."estimateNo", e."totalAmount" as header_total, coalesce(sum(el.quantity * el."unitPrice"), 0) as lines_total
from "Estimate" e
left join "EstimateLine" el on el."estimateId" = e.id
group by e.id
having abs(coalesce(sum(el.quantity * el."unitPrice"), 0) - e."totalAmount") > 0.01;

select i."invoiceNo", i."totalAmount" as header_total, coalesce(sum(bl.quantity * bl."unitPrice"), 0) as lines_total
from "Invoice" i
left join "BillingLine" bl on bl."invoiceId" = i.id
group by i.id
having abs(coalesce(sum(bl.quantity * bl."unitPrice"), 0) - i."totalAmount") > 0.01;

select po."poNo", po."totalAmount" as header_total, coalesce(sum(pol.quantity * pol."unitPrice"), 0) as lines_total
from "PurchaseOrder" po
left join "PurchaseOrderLine" pol on pol."purchaseOrderId" = po.id
group by po.id
having abs(coalesce(sum(pol.quantity * pol."unitPrice"), 0) - po."totalAmount") > 0.01;
