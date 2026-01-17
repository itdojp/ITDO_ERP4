-- Add indexes for rate card resolution queries.

CREATE INDEX IF NOT EXISTS "RateCard_projectId_workType_validFrom_idx"
ON "RateCard" ("projectId", "workType", "validFrom");

