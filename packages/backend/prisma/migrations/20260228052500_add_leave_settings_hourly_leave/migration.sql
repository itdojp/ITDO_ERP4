-- Add LeaveSetting for hourly leave policy (time unit / default workday)
CREATE TABLE "LeaveSetting" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "timeUnitMinutes" INTEGER NOT NULL DEFAULT 10,
  "defaultWorkdayMinutes" INTEGER NOT NULL DEFAULT 480,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "LeaveSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "LeaveSetting" (
  "id",
  "timeUnitMinutes",
  "defaultWorkdayMinutes",
  "createdAt",
  "updatedAt"
)
VALUES ('default', 10, 480, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Extend LeaveRequest for hourly leave
ALTER TABLE "LeaveRequest"
  ADD COLUMN "minutes" INTEGER,
  ADD COLUMN "startTimeMinutes" INTEGER,
  ADD COLUMN "endTimeMinutes" INTEGER;
