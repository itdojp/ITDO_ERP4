-- CreateTable
CREATE TABLE "ActionPolicy" (
    "id" TEXT NOT NULL,
    "flowType" "FlowType" NOT NULL,
    "actionKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "subjects" JSONB,
    "stateConstraints" JSONB,
    "requireReason" BOOLEAN NOT NULL DEFAULT false,
    "guards" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ActionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionPolicy_flowType_actionKey_idx" ON "ActionPolicy"("flowType", "actionKey");

-- CreateIndex
CREATE INDEX "ActionPolicy_flowType_actionKey_isEnabled_idx" ON "ActionPolicy"("flowType", "actionKey", "isEnabled");

-- CreateIndex
CREATE INDEX "ActionPolicy_isEnabled_idx" ON "ActionPolicy"("isEnabled");

