-- CreateTable
CREATE TABLE "LeaveIntegrationExportLog" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
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

    CONSTRAINT "LeaveIntegrationExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveIntegrationExportLog_target_idempotencyKey_key" ON "LeaveIntegrationExportLog"("target", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LeaveIntegrationExportLog_target_startedAt_idx" ON "LeaveIntegrationExportLog"("target", "startedAt");

-- CreateIndex
CREATE INDEX "LeaveIntegrationExportLog_status_startedAt_idx" ON "LeaveIntegrationExportLog"("status", "startedAt");
