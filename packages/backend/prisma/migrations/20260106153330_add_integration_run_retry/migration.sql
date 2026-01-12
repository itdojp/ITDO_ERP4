-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'integration_failure';

-- AlterTable
ALTER TABLE "IntegrationRun" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IntegrationRun" ADD COLUMN "nextRetryAt" TIMESTAMP(3);
