CREATE TABLE "ChatAckLink" (
  "id" TEXT NOT NULL,
  "ackRequestId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "targetTable" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "flowType" TEXT,
  "actionKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,

  CONSTRAINT "ChatAckLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatAckLink_ackRequestId_targetTable_targetId_key" ON "ChatAckLink"("ackRequestId", "targetTable", "targetId");
CREATE INDEX "ChatAckLink_targetTable_targetId_idx" ON "ChatAckLink"("targetTable", "targetId");
CREATE INDEX "ChatAckLink_ackRequestId_idx" ON "ChatAckLink"("ackRequestId");
CREATE INDEX "ChatAckLink_messageId_idx" ON "ChatAckLink"("messageId");

ALTER TABLE "ChatAckLink" ADD CONSTRAINT "ChatAckLink_ackRequestId_fkey" FOREIGN KEY ("ackRequestId") REFERENCES "ChatAckRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatAckLink" ADD CONSTRAINT "ChatAckLink_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
