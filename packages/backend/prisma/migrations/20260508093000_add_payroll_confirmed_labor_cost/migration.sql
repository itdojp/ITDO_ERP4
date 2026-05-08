CREATE TABLE "PayrollConfirmedLaborCost" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "employeeCode" TEXT,
    "departmentCode" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "totalMinutes" INTEGER,
    "sourceRef" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PayrollConfirmedLaborCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollConfirmedLaborCost_periodKey_projectId_idx" ON "PayrollConfirmedLaborCost"("periodKey", "projectId");
CREATE INDEX "PayrollConfirmedLaborCost_periodKey_departmentCode_idx" ON "PayrollConfirmedLaborCost"("periodKey", "departmentCode");
CREATE INDEX "PayrollConfirmedLaborCost_periodKey_userId_idx" ON "PayrollConfirmedLaborCost"("periodKey", "userId");
