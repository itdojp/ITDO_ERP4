ALTER TABLE "AttendanceClosingPeriod"
  ADD COLUMN "overtimeWithinStatutoryMinutesTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeOverStatutoryMinutesTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "holidayWorkMinutesTotal" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AttendanceMonthlySummary"
  ADD COLUMN "overtimeWithinStatutoryMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeOverStatutoryMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "holidayWorkMinutes" INTEGER NOT NULL DEFAULT 0;
