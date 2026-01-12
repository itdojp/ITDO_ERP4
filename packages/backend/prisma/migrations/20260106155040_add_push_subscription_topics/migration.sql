-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "topics" JSONB;
ALTER TABLE "PushSubscription" ADD COLUMN "consentAt" TIMESTAMP(3);
