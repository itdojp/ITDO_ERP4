-- data integrity improvements (Issue #595)

-- 1) prevent duplicate daily reports per user/day
CREATE UNIQUE INDEX IF NOT EXISTS "DailyReport_userId_reportDate_key"
ON "DailyReport"("userId", "reportDate");

-- 2) prevent duplicate wellbeing entries per user/day
CREATE UNIQUE INDEX IF NOT EXISTS "WellbeingEntry_userId_entryDate_key"
ON "WellbeingEntry"("userId", "entryDate");

-- 3) prevent duplicate open approval instances (idempotency guard)
-- open statuses: pending_qa / pending_exec
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalInstance_flowType_targetTable_targetId_open_key"
ON "ApprovalInstance"("flowType", "targetTable", "targetId")
WHERE "status" IN ('pending_qa', 'pending_exec');

