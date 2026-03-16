-- CreateTable
CREATE TABLE "AccountingIcsExportLog" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "periodKey" TEXT,
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

    CONSTRAINT "AccountingIcsExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingIcsExportLog_idempotencyKey_key" ON "AccountingIcsExportLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AccountingIcsExportLog_periodKey_startedAt_idx" ON "AccountingIcsExportLog"("periodKey", "startedAt");

-- CreateIndex
CREATE INDEX "AccountingIcsExportLog_status_startedAt_idx" ON "AccountingIcsExportLog"("status", "startedAt");
