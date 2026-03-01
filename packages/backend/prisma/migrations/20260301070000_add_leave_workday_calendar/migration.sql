-- Add leave workday calendar tables (company holidays + per-user workday overrides)
CREATE TABLE IF NOT EXISTS "LeaveCompanyHoliday" (
  "id" TEXT NOT NULL,
  "holidayDate" TIMESTAMP(3) NOT NULL,
  "name" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,
  CONSTRAINT "LeaveCompanyHoliday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeaveCompanyHoliday_holidayDate_key"
  ON "LeaveCompanyHoliday"("holidayDate");

CREATE TABLE IF NOT EXISTS "LeaveWorkdayOverride" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workDate" TIMESTAMP(3) NOT NULL,
  "workMinutes" INTEGER NOT NULL,
  "reasonText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,
  CONSTRAINT "LeaveWorkdayOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeaveWorkdayOverride_userId_workDate_key"
  ON "LeaveWorkdayOverride"("userId", "workDate");

CREATE INDEX IF NOT EXISTS "LeaveWorkdayOverride_workDate_idx"
  ON "LeaveWorkdayOverride"("workDate");
