-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AlertSetting" ADD COLUMN     "remindMaxCount" INTEGER DEFAULT 3;

