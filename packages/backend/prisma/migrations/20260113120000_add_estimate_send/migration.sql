-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN "estimateNo" TEXT;
ALTER TABLE "Estimate" ADD COLUMN "pdfUrl" TEXT;
ALTER TABLE "Estimate" ADD COLUMN "emailMessageId" TEXT;

-- Backfill estimate numbers for existing rows
UPDATE "Estimate"
SET "estimateNo" = 'Q' || to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM') || '-' || lpad(COALESCE("numberingSerial", "version")::text, 4, '0')
WHERE "estimateNo" IS NULL;

-- Enforce NOT NULL + UNIQUE
ALTER TABLE "Estimate" ALTER COLUMN "estimateNo" SET NOT NULL;
CREATE UNIQUE INDEX "Estimate_estimateNo_key" ON "Estimate"("estimateNo");

