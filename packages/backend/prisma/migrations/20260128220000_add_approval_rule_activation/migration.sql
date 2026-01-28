-- ApprovalRule versioning/activation fields (Issue #717)

ALTER TABLE "ApprovalRule"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "effectiveFrom" TIMESTAMP(3);

-- Backfill effectiveFrom for existing records to preserve ordering semantics.
UPDATE "ApprovalRule"
SET "effectiveFrom" = "createdAt"
WHERE "effectiveFrom" IS NULL;

ALTER TABLE "ApprovalRule"
ALTER COLUMN "effectiveFrom" SET NOT NULL,
ALTER COLUMN "effectiveFrom" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "ApprovalRule_flowType_isActive_effectiveFrom_idx"
ON "ApprovalRule"("flowType", "isActive", "effectiveFrom");

