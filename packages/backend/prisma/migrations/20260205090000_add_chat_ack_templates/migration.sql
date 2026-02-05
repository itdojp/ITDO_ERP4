ALTER TABLE "ChatAckRequest" ADD COLUMN "remindIntervalHours" INTEGER;
ALTER TABLE "ChatAckRequest" ADD COLUMN "escalationAfterHours" INTEGER;
ALTER TABLE "ChatAckRequest" ADD COLUMN "escalationUserIds" JSONB;
ALTER TABLE "ChatAckRequest" ADD COLUMN "escalationGroupIds" JSONB;
ALTER TABLE "ChatAckRequest" ADD COLUMN "escalationRoles" JSONB;
ALTER TABLE "ChatAckRequest" ADD COLUMN "templateId" TEXT;

CREATE TABLE "ChatAckTemplate" (
  "id" TEXT NOT NULL,
  "flowType" "FlowType" NOT NULL,
  "actionKey" TEXT NOT NULL,
  "messageBody" TEXT NOT NULL,
  "requiredUserIds" JSONB,
  "requiredGroupIds" JSONB,
  "requiredRoles" JSONB,
  "dueInHours" INTEGER,
  "remindIntervalHours" INTEGER,
  "escalationAfterHours" INTEGER,
  "escalationUserIds" JSONB,
  "escalationGroupIds" JSONB,
  "escalationRoles" JSONB,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,

  CONSTRAINT "ChatAckTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChatAckLink" ADD COLUMN "templateId" TEXT;

CREATE INDEX "ChatAckTemplate_flowType_actionKey_isEnabled_idx" ON "ChatAckTemplate"("flowType", "actionKey", "isEnabled");
CREATE INDEX "ChatAckLink_templateId_idx" ON "ChatAckLink"("templateId");
CREATE INDEX "ChatAckRequest_templateId_idx" ON "ChatAckRequest"("templateId");

ALTER TABLE "ChatAckRequest" ADD CONSTRAINT "ChatAckRequest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChatAckTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatAckLink" ADD CONSTRAINT "ChatAckLink_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChatAckTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
