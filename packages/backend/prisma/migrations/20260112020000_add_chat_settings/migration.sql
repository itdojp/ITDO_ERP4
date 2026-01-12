-- CreateTable
CREATE TABLE "ChatSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "allowUserPrivateGroupCreation" BOOLEAN NOT NULL DEFAULT true,
    "allowDmCreation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ChatSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ChatSetting" ("id", "allowUserPrivateGroupCreation", "allowDmCreation", "createdAt", "updatedAt")
VALUES ('default', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

