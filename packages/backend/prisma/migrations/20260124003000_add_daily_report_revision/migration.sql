-- AlterTable
ALTER TABLE "DailyReport" ALTER COLUMN "reportDate" TYPE DATE USING ("reportDate"::date);

-- CreateTable
CREATE TABLE "DailyReportRevision" (
    "id" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "linkedProjectIds" JSONB,
    "status" TEXT,
    "reasonText" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "createdBy" TEXT,

    CONSTRAINT "DailyReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyReportRevision_dailyReportId_version_key" ON "DailyReportRevision"("dailyReportId", "version");
CREATE INDEX "DailyReportRevision_dailyReportId_createdAt_idx" ON "DailyReportRevision"("dailyReportId", "createdAt");

-- AddForeignKey
ALTER TABLE "DailyReportRevision"
ADD CONSTRAINT "DailyReportRevision_dailyReportId_fkey"
FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
