-- Add WorklogSetting for worklog correction policy
CREATE TABLE "WorklogSetting" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "editableDays" INTEGER NOT NULL DEFAULT 14,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "WorklogSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WorklogSetting" ("id", "editableDays", "createdAt", "updatedAt")
VALUES ('default', 14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
