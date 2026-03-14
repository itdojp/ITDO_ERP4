-- AlterTable
ALTER TABLE "UserAccount"
ADD COLUMN "employeeCode" TEXT,
ADD COLUMN "employmentType" TEXT,
ADD COLUMN "joinedAt" TIMESTAMP(3),
ADD COLUMN "leftAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmployeePayrollProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payrollType" TEXT,
    "closingType" TEXT,
    "paymentType" TEXT,
    "titleCode" TEXT,
    "departmentCode" TEXT,
    "bankInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "EmployeePayrollProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_employeeCode_key" ON "UserAccount"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayrollProfile_userId_key" ON "EmployeePayrollProfile"("userId");

-- CreateIndex
CREATE INDEX "EmployeePayrollProfile_departmentCode_idx" ON "EmployeePayrollProfile"("departmentCode");

-- CreateIndex
CREATE INDEX "EmployeePayrollProfile_titleCode_idx" ON "EmployeePayrollProfile"("titleCode");

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile"
ADD CONSTRAINT "EmployeePayrollProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "UserAccount"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
