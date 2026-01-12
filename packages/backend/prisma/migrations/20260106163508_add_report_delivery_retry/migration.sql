ALTER TABLE "ReportDelivery" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReportDelivery" ADD COLUMN "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "ReportDelivery" ADD COLUMN "lastErrorAt" TIMESTAMP(3);

CREATE INDEX "ReportDelivery_status_nextRetryAt_idx" ON "ReportDelivery"("status", "nextRetryAt");
