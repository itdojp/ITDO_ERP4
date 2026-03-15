-- CreateTable
CREATE TABLE "HrEmployeeMasterExportLog" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "updatedSince" TIMESTAMP(3),
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
    CONSTRAINT "HrEmployeeMasterExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployeeMasterExportLog_idempotencyKey_key" ON "HrEmployeeMasterExportLog"("idempotencyKey");
CREATE INDEX "HrEmployeeMasterExportLog_status_startedAt_idx" ON "HrEmployeeMasterExportLog"("status", "startedAt");
