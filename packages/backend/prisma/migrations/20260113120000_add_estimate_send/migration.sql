-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN "estimateNo" TEXT;
ALTER TABLE "Estimate" ADD COLUMN "pdfUrl" TEXT;
ALTER TABLE "Estimate" ADD COLUMN "emailMessageId" TEXT;

-- Backfill estimate numbers for existing rows
UPDATE "Estimate" e
SET "estimateNo" = CASE
    WHEN s.rn = 1 THEN s.base
    ELSE s.base || '-' || lpad(s.rn::text, 2, '0')
END
FROM (
    SELECT
        "id",
        'Q' || to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM') || '-' || lpad(COALESCE("numberingSerial", "version")::text, 4, '0') AS base,
        row_number() OVER (
            PARTITION BY to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM'),
                         COALESCE("numberingSerial", "version")
            ORDER BY "createdAt", "id"
        ) AS rn
    FROM "Estimate"
    WHERE "estimateNo" IS NULL
) AS s
WHERE e."id" = s."id";

-- Enforce NOT NULL + UNIQUE
ALTER TABLE "Estimate" ALTER COLUMN "estimateNo" SET NOT NULL;
CREATE UNIQUE INDEX "Estimate_estimateNo_key" ON "Estimate"("estimateNo");
