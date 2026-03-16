ALTER TABLE "LeaveIntegrationExportLog"
  ADD COLUMN "reexportOfId" TEXT;

ALTER TABLE "HrEmployeeMasterExportLog"
  ADD COLUMN "reexportOfId" TEXT;

ALTER TABLE "AccountingIcsExportLog"
  ADD COLUMN "reexportOfId" TEXT;

CREATE INDEX "LeaveIntegrationExportLog_reexportOfId_startedAt_idx"
  ON "LeaveIntegrationExportLog"("reexportOfId", "startedAt");

CREATE INDEX "HrEmployeeMasterExportLog_reexportOfId_startedAt_idx"
  ON "HrEmployeeMasterExportLog"("reexportOfId", "startedAt");

CREATE INDEX "AccountingIcsExportLog_reexportOfId_startedAt_idx"
  ON "AccountingIcsExportLog"("reexportOfId", "startedAt");
