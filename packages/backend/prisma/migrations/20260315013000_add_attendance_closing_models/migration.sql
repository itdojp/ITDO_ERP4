-- CreateEnum
CREATE TYPE "AttendanceClosingStatus" AS ENUM ('closed', 'superseded');

-- CreateTable
CREATE TABLE "AttendanceClosingPeriod" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "AttendanceClosingStatus" NOT NULL DEFAULT 'closed',
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededBy" TEXT,
    "summaryCount" INTEGER NOT NULL DEFAULT 0,
    "workedDayCountTotal" INTEGER NOT NULL DEFAULT 0,
    "scheduledWorkMinutesTotal" INTEGER NOT NULL DEFAULT 0,
    "approvedWorkMinutesTotal" INTEGER NOT NULL DEFAULT 0,
    "overtimeTotalMinutesTotal" INTEGER NOT NULL DEFAULT 0,
    "paidLeaveMinutesTotal" INTEGER NOT NULL DEFAULT 0,
    "unpaidLeaveMinutesTotal" INTEGER NOT NULL DEFAULT 0,
    "totalLeaveMinutesTotal" INTEGER NOT NULL DEFAULT 0,
    "sourceTimeEntryCount" INTEGER NOT NULL DEFAULT 0,
    "sourceLeaveRequestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "AttendanceClosingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceMonthlySummary" (
    "id" TEXT NOT NULL,
    "closingPeriodId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "workedDayCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledWorkMinutes" INTEGER NOT NULL DEFAULT 0,
    "approvedWorkMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeTotalMinutes" INTEGER NOT NULL DEFAULT 0,
    "paidLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "unpaidLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "sourceTimeEntryCount" INTEGER NOT NULL DEFAULT 0,
    "sourceLeaveRequestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "AttendanceMonthlySummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceClosingPeriod_periodKey_version_key" ON "AttendanceClosingPeriod"("periodKey", "version");
CREATE INDEX "AttendanceClosingPeriod_periodKey_status_version_idx" ON "AttendanceClosingPeriod"("periodKey", "status", "version");
CREATE UNIQUE INDEX "AttendanceMonthlySummary_closingPeriodId_userId_key" ON "AttendanceMonthlySummary"("closingPeriodId", "userId");
CREATE INDEX "AttendanceMonthlySummary_periodKey_version_idx" ON "AttendanceMonthlySummary"("periodKey", "version");
CREATE INDEX "AttendanceMonthlySummary_employeeCode_idx" ON "AttendanceMonthlySummary"("employeeCode");
CREATE INDEX "AttendanceMonthlySummary_userId_periodKey_idx" ON "AttendanceMonthlySummary"("userId", "periodKey");

-- AddForeignKey
ALTER TABLE "AttendanceMonthlySummary"
  ADD CONSTRAINT "AttendanceMonthlySummary_closingPeriodId_fkey"
  FOREIGN KEY ("closingPeriodId") REFERENCES "AttendanceClosingPeriod"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
