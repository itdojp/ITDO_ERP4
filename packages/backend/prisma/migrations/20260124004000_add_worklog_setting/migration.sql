-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "WorklogSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "editableDays" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "WorklogSetting_pkey" PRIMARY KEY ("id")
);

-- Seed default
INSERT INTO "WorklogSetting" ("id", "editableDays", "createdAt", "updatedAt")
VALUES ('default', 14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
