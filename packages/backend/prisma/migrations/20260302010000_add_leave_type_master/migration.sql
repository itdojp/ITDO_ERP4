CREATE TABLE "LeaveType" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isPaid" BOOLEAN NOT NULL DEFAULT false,
  "unit" TEXT NOT NULL DEFAULT 'daily',
  "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
  "attachmentPolicy" TEXT NOT NULL DEFAULT 'optional',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 100,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code");
CREATE INDEX "LeaveType_active_displayOrder_code_idx" ON "LeaveType"("active", "displayOrder", "code");
CREATE INDEX "LeaveType_effectiveFrom_idx" ON "LeaveType"("effectiveFrom");
