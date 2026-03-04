-- B1 scaffold for append-only ApprovalRule versioning.
-- Keep behavior backward-compatible while adding metadata for later cutover.

ALTER TABLE "ApprovalRule"
ADD COLUMN "ruleKey" TEXT,
ADD COLUMN "effectiveTo" TIMESTAMP(3),
ADD COLUMN "supersedesRuleId" TEXT;

-- Existing rows become version roots keyed by their current id.
UPDATE "ApprovalRule"
SET "ruleKey" = "id"
WHERE "ruleKey" IS NULL;

ALTER TABLE "ApprovalRule"
ALTER COLUMN "ruleKey" SET NOT NULL;

ALTER TABLE "ApprovalRule"
ADD CONSTRAINT "ApprovalRule_supersedesRuleId_fkey"
FOREIGN KEY ("supersedesRuleId") REFERENCES "ApprovalRule"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ApprovalRule_flowType_ruleKey_version_idx"
ON "ApprovalRule"("flowType", "ruleKey", "version");

CREATE INDEX IF NOT EXISTS "ApprovalRule_flowType_ruleKey_isActive_effectiveFrom_idx"
ON "ApprovalRule"("flowType", "ruleKey", "isActive", "effectiveFrom");

CREATE INDEX IF NOT EXISTS "ApprovalRule_supersedesRuleId_idx"
ON "ApprovalRule"("supersedesRuleId");

ALTER TABLE "ApprovalInstance"
ADD COLUMN "ruleVersion" INTEGER,
ADD COLUMN "ruleSnapshot" JSONB;

-- Backfill from currently linked rule where possible.
UPDATE "ApprovalInstance" ai
SET
  "ruleVersion" = ar."version",
  "ruleSnapshot" = jsonb_build_object(
    'id', ar."id",
    'ruleKey', ar."ruleKey",
    'version', ar."version",
    'flowType', ar."flowType",
    'isActive', ar."isActive",
    'effectiveFrom', ar."effectiveFrom",
    'effectiveTo', ar."effectiveTo",
    'supersedesRuleId', ar."supersedesRuleId",
    'conditions', ar."conditions",
    'steps', ar."steps"
  )
FROM "ApprovalRule" ar
WHERE ar."id" = ai."ruleId"
  AND (ai."ruleVersion" IS NULL OR ai."ruleSnapshot" IS NULL);
