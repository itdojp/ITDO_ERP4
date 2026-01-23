-- CreateTable
CREATE TABLE "WorklogSetting" (
    "id" TEXT NOT NULL,
    "editableDays" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "createdBy" TEXT,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedBy" TEXT,

    CONSTRAINT "WorklogSetting_pkey" PRIMARY KEY ("id")
);

-- Seed default
INSERT INTO "WorklogSetting" ("id", "editableDays")
VALUES ('default', 14)
ON CONFLICT ("id") DO NOTHING;
