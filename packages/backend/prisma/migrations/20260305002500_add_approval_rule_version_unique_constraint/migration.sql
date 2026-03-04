-- Ensure version uniqueness per (flowType, ruleKey) for append-only versioning.
-- In case duplicates were created before this constraint, deterministically bump
-- later duplicates to the tail of each series.
WITH duplicates AS (
  SELECT
    ar."id",
    ar."flowType",
    ar."ruleKey",
    ROW_NUMBER() OVER (
      PARTITION BY ar."flowType", ar."ruleKey", ar."version"
      ORDER BY ar."createdAt", ar."id"
    ) AS duplicate_rank
  FROM "ApprovalRule" ar
),
to_bump AS (
  SELECT
    d."id",
    d."flowType",
    d."ruleKey",
    (
      SELECT COALESCE(MAX(ar2."version"), 0)
      FROM "ApprovalRule" ar2
      WHERE
        ar2."flowType" = d."flowType"
        AND ar2."ruleKey" = d."ruleKey"
    ) + ROW_NUMBER() OVER (
      PARTITION BY d."flowType", d."ruleKey"
      ORDER BY d."id"
    ) AS next_version
  FROM duplicates d
  WHERE d.duplicate_rank > 1
)
UPDATE "ApprovalRule" ar
SET "version" = b.next_version
FROM to_bump b
WHERE ar."id" = b."id";

CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalRule_flowType_ruleKey_version_key"
ON "ApprovalRule"("flowType", "ruleKey", "version");
