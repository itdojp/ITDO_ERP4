-- Performance measurement template for ITDO_ERP4.
-- Usage:
--   psql "$DATABASE_URL" -v start_date='2025-01-01' -v end_date='2025-01-31' \
--     -v project_id='00000000-0000-0000-0000-000000000000' \
--     -v approver_group_id='00000000-0000-0000-0000-000000000000' \
--     -v approver_user_id='00000000-0000-0000-0000-000000000000' \
--     -v status='pending_qa' -v alert_status='open' \
--     -f scripts/checks/perf-explain.sql
--
-- Replace the UUIDs with real IDs from staging for representative plans.

\set start_date '2025-01-01'
\set end_date '2025-01-31'
\set project_id '00000000-0000-0000-0000-000000000000'
\set approver_group_id '00000000-0000-0000-0000-000000000000'
\set approver_user_id '00000000-0000-0000-0000-000000000000'
\set status 'pending_qa'
\set alert_status 'open'

\echo '== Approval list by status =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT ai.*
FROM "ApprovalInstance" ai
WHERE ai."status" = :'status'
ORDER BY ai."createdAt" DESC
LIMIT 100;

\echo '== Approval list by status + project =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT ai.*
FROM "ApprovalInstance" ai
WHERE ai."status" = :'status'
  AND ai."projectId" = :'project_id'
ORDER BY ai."createdAt" DESC
LIMIT 100;

\echo '== Approval list by approver group =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT ai.*
FROM "ApprovalInstance" ai
WHERE EXISTS (
  SELECT 1
  FROM "ApprovalStep" st
  WHERE st."instanceId" = ai."id"
    AND st."status" = :'status'
    AND st."approverGroupId" = :'approver_group_id'
)
ORDER BY ai."createdAt" DESC
LIMIT 100;

\echo '== Alerts by status =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "Alert"
WHERE "status" = :'alert_status'
ORDER BY "triggeredAt" DESC
LIMIT 100;

\echo '== Alerts by targetRef + status =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "Alert"
WHERE "targetRef" = 'approval_instance:' || :'project_id'
  AND "status" = :'alert_status'
ORDER BY "triggeredAt" DESC
LIMIT 100;

\echo '== TimeEntry monthly summary =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  "projectId",
  "userId",
  date_trunc('month', "workDate") AS period,
  SUM("minutes") AS total_minutes
FROM "TimeEntry"
WHERE "workDate" >= :'start_date'::date
  AND "workDate" < (:'end_date'::date + INTERVAL '1 day')
GROUP BY 1, 2, 3;

\echo '== TimeEntry monthly by project =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  "projectId",
  date_trunc('month', "workDate") AS period,
  SUM("minutes") AS total_minutes
FROM "TimeEntry"
WHERE "projectId" = :'project_id'
  AND "workDate" >= :'start_date'::date
  AND "workDate" < (:'end_date'::date + INTERVAL '1 day')
GROUP BY 1, 2;

\echo '== Expense monthly by project =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  "projectId",
  date_trunc('month', "incurredOn") AS period,
  SUM("amount") AS total_amount
FROM "Expense"
WHERE "projectId" = :'project_id'
GROUP BY 1, 2;
