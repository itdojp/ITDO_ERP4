ALTER TABLE "ChatAckRequest" ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "ChatAckRequest" ADD COLUMN "canceledBy" TEXT;
