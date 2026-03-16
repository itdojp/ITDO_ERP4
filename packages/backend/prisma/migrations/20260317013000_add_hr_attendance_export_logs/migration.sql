-- CreateTable
CREATE TABLE "HrAttendanceExportLog" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reexportOfId" TEXT,
    "periodKey" TEXT NOT NULL,
    "closingPeriodId" TEXT NOT NULL,
    "closingVersion" INTEGER NOT NULL,
    "exportedUntil" TIMESTAMP(3) NOT NULL,
    "status" "IntegrationRunStatus" NOT NULL DEFAULT 'running',
    "exportedCount" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrAttendanceExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendanceExportLog_idempotencyKey_key" ON "HrAttendanceExportLog"("idempotencyKey");
CREATE INDEX "HrAttendanceExportLog_periodKey_startedAt_idx" ON "HrAttendanceExportLog"("periodKey", "startedAt");
CREATE INDEX "HrAttendanceExportLog_closingPeriodId_startedAt_idx" ON "HrAttendanceExportLog"("closingPeriodId", "startedAt");
CREATE INDEX "HrAttendanceExportLog_status_startedAt_idx" ON "HrAttendanceExportLog"("status", "startedAt");
CREATE INDEX "HrAttendanceExportLog_reexportOfId_startedAt_idx" ON "HrAttendanceExportLog"("reexportOfId", "startedAt");
