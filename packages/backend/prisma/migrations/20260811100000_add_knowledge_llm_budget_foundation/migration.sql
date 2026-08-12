-- CreateEnum
CREATE TYPE "KnowledgeLlmProvider" AS ENUM ('stub', 'openai');

-- CreateEnum
CREATE TYPE "KnowledgeLlmRunScope" AS ENUM ('personal', 'organization');

-- CreateEnum
CREATE TYPE "KnowledgeLlmBudgetSubjectType" AS ENUM ('user', 'organization');

-- CreateEnum
CREATE TYPE "KnowledgeLlmExecutionStatus" AS ENUM ('reserved', 'dispatched', 'result_ready', 'failed', 'result_unknown');

-- CreateEnum
CREATE TYPE "KnowledgeLlmSettlementStatus" AS ENUM ('reserved', 'settled_actual', 'released', 'held_maximum');

-- CreateEnum
CREATE TYPE "KnowledgeLlmContextSourceType" AS ENUM ('snapshot', 'annotation_revision', 'conversation_turn', 'synthesis_version', 'thread_promotion_message');

-- CreateEnum
CREATE TYPE "KnowledgeLlmOutcomeStatus" AS ENUM ('valid', 'usage_unknown', 'invalid');

-- CreateEnum
CREATE TYPE "KnowledgeLlmUsageEvidenceSource" AS ENUM ('operator_billing');

-- CreateEnum
CREATE TYPE "KnowledgeLlmFailureCode" AS ENUM ('disabled', 'budget_hard_limit', 'rate_limit', 'rejected_before_dispatch', 'provider_4xx', 'provider_5xx', 'malformed_response', 'response_oversize', 'empty_result', 'timeout_outcome_unknown', 'connection_outcome_unknown', 'usage_missing', 'usage_invalid', 'finalization_failed');

-- CreateTable
CREATE TABLE "KnowledgeLlmBudgetPolicy" (
    "id" TEXT NOT NULL,
    "subjectType" "KnowledgeLlmBudgetSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "softLimitMicros" BIGINT NOT NULL,
    "hardLimitMicros" BIGINT NOT NULL,
    "requestsPerHour" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "KnowledgeLlmBudgetPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLlmBudgetPeriod" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "periodStartUtc" TIMESTAMP(3) NOT NULL,
    "periodEndUtc" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "activeReservedMicros" BIGINT NOT NULL DEFAULT 0,
    "settledActualMicros" BIGINT NOT NULL DEFAULT 0,
    "heldMaximumMicros" BIGINT NOT NULL DEFAULT 0,
    "releasedMicros" BIGINT NOT NULL DEFAULT 0,
    "acceptedRequestCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeLlmBudgetPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLlmRun" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "scope" "KnowledgeLlmRunScope" NOT NULL,
    "organizationId" TEXT,
    "provider" "KnowledgeLlmProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "catalogVersion" INTEGER NOT NULL,
    "promptTemplateVersion" INTEGER NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "providerRequestHash" TEXT NOT NULL,
    "selectedContextFingerprint" TEXT NOT NULL,
    "estimatedInputTokens" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "inputCostMicrosPerMillion" BIGINT NOT NULL,
    "outputCostMicrosPerMillion" BIGINT NOT NULL,
    "maximumCostMicros" BIGINT NOT NULL,
    "softLimitWarning" BOOLEAN NOT NULL DEFAULT false,
    "actualInputTokens" INTEGER,
    "actualOutputTokens" INTEGER,
    "actualCostMicros" BIGINT,
    "currency" TEXT NOT NULL,
    "executionStatus" "KnowledgeLlmExecutionStatus" NOT NULL DEFAULT 'reserved',
    "settlementStatus" "KnowledgeLlmSettlementStatus" NOT NULL DEFAULT 'reserved',
    "failureCode" "KnowledgeLlmFailureCode",
    "conversationId" TEXT,
    "assistantTurnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeLlmRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLlmRequest" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "requestKeyHash" TEXT NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "KnowledgeLlmRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLlmReservation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "budgetPeriodId" TEXT NOT NULL,
    "maximumCostMicros" BIGINT NOT NULL,
    "actualCostMicros" BIGINT,
    "status" "KnowledgeLlmSettlementStatus" NOT NULL DEFAULT 'reserved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeLlmReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLlmContextSource" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceType" "KnowledgeLlmContextSourceType" NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "sourceSnapshotId" TEXT,
    "sourceAnnotationRevisionId" TEXT,
    "sourceConversationTurnId" TEXT,
    "sourceSynthesisVersionId" TEXT,
    "sourceThreadPromotionMessageId" TEXT,
    "exactSourceVersion" INTEGER NOT NULL,
    "exactSourceHash" TEXT NOT NULL,
    "representationHash" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "estimatedTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "KnowledgeLlmContextSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLlmProviderOutcome" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "KnowledgeLlmOutcomeStatus" NOT NULL,
    "normalizedContent" TEXT,
    "contentHash" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "failureCode" "KnowledgeLlmFailureCode",
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeLlmProviderOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLlmUsageEvidence" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "source" "KnowledgeLlmUsageEvidenceSource" NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "actualCostMicros" BIGINT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "KnowledgeLlmUsageEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeLlmBudgetPolicy_subjectType_subjectId_active_versi_idx" ON "KnowledgeLlmBudgetPolicy"("subjectType", "subjectId", "active", "version");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmBudgetPolicy_subjectType_subjectId_version_key" ON "KnowledgeLlmBudgetPolicy"("subjectType", "subjectId", "version");

-- CreateIndex
CREATE INDEX "KnowledgeLlmBudgetPeriod_policyId_periodEndUtc_periodStartU_idx" ON "KnowledgeLlmBudgetPeriod"("policyId", "periodEndUtc", "periodStartUtc");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmBudgetPeriod_policyId_periodStartUtc_key" ON "KnowledgeLlmBudgetPeriod"("policyId", "periodStartUtc");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmRun_assistantTurnId_key" ON "KnowledgeLlmRun"("assistantTurnId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmRun_actorUserId_createdAt_id_idx" ON "KnowledgeLlmRun"("actorUserId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeLlmRun_organizationId_createdAt_id_idx" ON "KnowledgeLlmRun"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeLlmRun_executionStatus_settlementStatus_updatedAt__idx" ON "KnowledgeLlmRun"("executionStatus", "settlementStatus", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmRun_id_actorUserId_key" ON "KnowledgeLlmRun"("id", "actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmRequest_runId_key" ON "KnowledgeLlmRequest"("runId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmRequest_runId_actorUserId_idx" ON "KnowledgeLlmRequest"("runId", "actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmRequest_actorUserId_requestKeyHash_key" ON "KnowledgeLlmRequest"("actorUserId", "requestKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmRequest_runId_actorUserId_key" ON "KnowledgeLlmRequest"("runId", "actorUserId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmReservation_budgetPeriodId_status_createdAt_id_idx" ON "KnowledgeLlmReservation"("budgetPeriodId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmReservation_runId_budgetPeriodId_key" ON "KnowledgeLlmReservation"("runId", "budgetPeriodId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmContextSource_sourceSnapshotId_idx" ON "KnowledgeLlmContextSource"("sourceSnapshotId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmContextSource_sourceAnnotationRevisionId_idx" ON "KnowledgeLlmContextSource"("sourceAnnotationRevisionId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmContextSource_sourceConversationTurnId_idx" ON "KnowledgeLlmContextSource"("sourceConversationTurnId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmContextSource_sourceSynthesisVersionId_idx" ON "KnowledgeLlmContextSource"("sourceSynthesisVersionId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmContextSource_sourceThreadPromotionMessageId_idx" ON "KnowledgeLlmContextSource"("sourceThreadPromotionMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmContextSource_runId_ordinal_key" ON "KnowledgeLlmContextSource"("runId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmContextSource_runId_sourceSnapshotId_key" ON "KnowledgeLlmContextSource"("runId", "sourceSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmContextSource_runId_sourceAnnotationRevisionId_key" ON "KnowledgeLlmContextSource"("runId", "sourceAnnotationRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmContextSource_runId_sourceConversationTurnId_key" ON "KnowledgeLlmContextSource"("runId", "sourceConversationTurnId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmContextSource_runId_sourceSynthesisVersionId_key" ON "KnowledgeLlmContextSource"("runId", "sourceSynthesisVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmContextSource_runId_sourceThreadPromotionMessag_key" ON "KnowledgeLlmContextSource"("runId", "sourceThreadPromotionMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmProviderOutcome_runId_key" ON "KnowledgeLlmProviderOutcome"("runId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmProviderOutcome_status_finalizedAt_capturedAt_i_idx" ON "KnowledgeLlmProviderOutcome"("status", "finalizedAt", "capturedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLlmUsageEvidence_runId_key" ON "KnowledgeLlmUsageEvidence"("runId");

-- CreateIndex
CREATE INDEX "KnowledgeLlmUsageEvidence_source_createdAt_id_idx" ON "KnowledgeLlmUsageEvidence"("source", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "KnowledgeLlmBudgetPeriod" ADD CONSTRAINT "KnowledgeLlmBudgetPeriod_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "KnowledgeLlmBudgetPolicy"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmRun" ADD CONSTRAINT "KnowledgeLlmRun_conversationId_actorUserId_fkey" FOREIGN KEY ("conversationId", "actorUserId") REFERENCES "KnowledgeConversation"("id", "ownerUserId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmRun" ADD CONSTRAINT "KnowledgeLlmRun_assistantTurnId_conversationId_fkey" FOREIGN KEY ("assistantTurnId", "conversationId") REFERENCES "KnowledgeConversationTurn"("id", "conversationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmRequest" ADD CONSTRAINT "KnowledgeLlmRequest_runId_actorUserId_fkey" FOREIGN KEY ("runId", "actorUserId") REFERENCES "KnowledgeLlmRun"("id", "actorUserId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmReservation" ADD CONSTRAINT "KnowledgeLlmReservation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KnowledgeLlmRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmReservation" ADD CONSTRAINT "KnowledgeLlmReservation_budgetPeriodId_fkey" FOREIGN KEY ("budgetPeriodId") REFERENCES "KnowledgeLlmBudgetPeriod"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmContextSource" ADD CONSTRAINT "KnowledgeLlmContextSource_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KnowledgeLlmRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmContextSource" ADD CONSTRAINT "KnowledgeLlmContextSource_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "KnowledgeSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmContextSource" ADD CONSTRAINT "KnowledgeLlmContextSource_sourceAnnotationRevisionId_fkey" FOREIGN KEY ("sourceAnnotationRevisionId") REFERENCES "KnowledgeAnnotationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmContextSource" ADD CONSTRAINT "KnowledgeLlmContextSource_sourceConversationTurnId_fkey" FOREIGN KEY ("sourceConversationTurnId") REFERENCES "KnowledgeConversationTurn"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmContextSource" ADD CONSTRAINT "KnowledgeLlmContextSource_sourceSynthesisVersionId_fkey" FOREIGN KEY ("sourceSynthesisVersionId") REFERENCES "KnowledgeSynthesisVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmContextSource" ADD CONSTRAINT "KnowledgeLlmContextSource_sourceThreadPromotionMessageId_fkey" FOREIGN KEY ("sourceThreadPromotionMessageId") REFERENCES "KnowledgeThreadPromotionMessage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmProviderOutcome" ADD CONSTRAINT "KnowledgeLlmProviderOutcome_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KnowledgeLlmRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "KnowledgeLlmUsageEvidence" ADD CONSTRAINT "KnowledgeLlmUsageEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KnowledgeLlmRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Application-independent integrity for budget accounting and immutable
-- provenance. These tables are expand-only and contain no existing-row
-- rewrites.

CREATE FUNCTION "erp4_knowledge_llm_auth_identifier_valid"(
  candidate TEXT,
  maximum_length INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  WITH codepoints AS (
    SELECT
      character_index,
      ASCII(SUBSTRING(candidate FROM character_index FOR 1)) AS codepoint
    FROM GENERATE_SERIES(1, CHAR_LENGTH(candidate)) AS characters(character_index)
  )
  SELECT maximum_length BETWEEN 1 AND 2048
    AND candidate = BTRIM(candidate)
    AND (
      SELECT COALESCE(SUM(CASE WHEN codepoint > 65535 THEN 2 ELSE 1 END), 0)
      FROM codepoints
    ) BETWEEN 1 AND maximum_length
    AND NOT EXISTS (
      SELECT 1
      FROM codepoints
      WHERE codepoint BETWEEN 0 AND 31
        OR codepoint BETWEEN 127 AND 159
        OR codepoint = 173
        OR codepoint BETWEEN 1536 AND 1541
        OR codepoint = 1564
        OR codepoint = 1757
        OR codepoint = 1807
        OR codepoint BETWEEN 2192 AND 2193
        OR codepoint = 2274
        OR codepoint BETWEEN 6068 AND 6069
        OR codepoint = 6158
        OR codepoint BETWEEN 8203 AND 8207
        OR codepoint BETWEEN 8232 AND 8238
        OR codepoint BETWEEN 8288 AND 8292
        OR codepoint BETWEEN 8294 AND 8303
        OR codepoint = 65279
        OR codepoint BETWEEN 65529 AND 65531
        OR codepoint IN (69821, 69837)
        OR codepoint BETWEEN 78896 AND 78933
        OR codepoint BETWEEN 113824 AND 113839
        OR codepoint BETWEEN 119155 AND 119162
        OR codepoint = 917505
        OR codepoint BETWEEN 917536 AND 917631
    )
    AND (
      SELECT codepoint
      FROM codepoints
      WHERE character_index = 1
    ) NOT IN (160, 5760, 8239, 8287, 12288)
    AND NOT (
      SELECT codepoint
      FROM codepoints
      WHERE character_index = 1
    ) BETWEEN 8192 AND 8202
    AND (
      SELECT codepoint
      FROM codepoints
      WHERE character_index = CHAR_LENGTH(candidate)
    ) NOT IN (160, 5760, 8239, 8287, 12288)
    AND NOT (
      SELECT codepoint
      FROM codepoints
      WHERE character_index = CHAR_LENGTH(candidate)
    ) BETWEEN 8192 AND 8202;
$$;

CREATE FUNCTION "erp4_knowledge_llm_timezone_valid"(candidate TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT candidate = BTRIM(candidate)
    AND CHAR_LENGTH(candidate) BETWEEN 1 AND 100
    AND EXISTS (
      SELECT 1
      FROM pg_timezone_names
      WHERE name = candidate
    );
$$;

ALTER TABLE "KnowledgeLlmBudgetPolicy"
  ADD CONSTRAINT "KnowledgeLlmBudgetPolicy_identity_check" CHECK (
    "erp4_knowledge_llm_auth_identifier_valid"("subjectId", 200)
    AND "currency" ~ '^[A-Z]{3}$'
    AND "erp4_knowledge_llm_timezone_valid"("timezone")
    AND "erp4_knowledge_llm_auth_identifier_valid"("createdBy", 200)
    AND "erp4_knowledge_llm_auth_identifier_valid"("updatedBy", 200)
  ),
  ADD CONSTRAINT "KnowledgeLlmBudgetPolicy_limits_check" CHECK (
    "softLimitMicros" >= 0
    AND "hardLimitMicros" > 0
    AND "softLimitMicros" <= "hardLimitMicros"
    AND "requestsPerHour" BETWEEN 1 AND 10000
    AND "version" >= 1
    AND "updatedAt" >= "createdAt"
  );

CREATE UNIQUE INDEX "KnowledgeLlmBudgetPolicy_one_active_subject_key"
  ON "KnowledgeLlmBudgetPolicy"("subjectType", "subjectId")
  WHERE "active";

CREATE FUNCTION "erp4_knowledge_llm_policy_version_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."subjectType" <> NEW."subjectType"
    OR OLD."subjectId" <> NEW."subjectId"
    OR OLD."currency" <> NEW."currency"
    OR OLD."timezone" <> NEW."timezone"
    OR OLD."softLimitMicros" <> NEW."softLimitMicros"
    OR OLD."hardLimitMicros" <> NEW."hardLimitMicros"
    OR OLD."requestsPerHour" <> NEW."requestsPerHour"
    OR OLD."version" <> NEW."version"
    OR OLD."createdAt" <> NEW."createdAt"
    OR OLD."createdBy" <> NEW."createdBy"
    OR (NOT OLD."active" AND NEW."active")
  THEN
    RAISE EXCEPTION 'KnowledgeLlmBudgetPolicy versions are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmBudgetPolicy_version_guard"
  BEFORE UPDATE ON "KnowledgeLlmBudgetPolicy"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_policy_version_guard"();

ALTER TABLE "KnowledgeLlmBudgetPeriod"
  ADD CONSTRAINT "KnowledgeLlmBudgetPeriod_window_check" CHECK (
    "periodEndUtc" > "periodStartUtc"
    AND "currency" ~ '^[A-Z]{3}$'
    AND "erp4_knowledge_llm_timezone_valid"("timezone")
    AND "version" >= 1
    AND "updatedAt" >= "createdAt"
  ),
  ADD CONSTRAINT "KnowledgeLlmBudgetPeriod_counters_check" CHECK (
    "activeReservedMicros" >= 0
    AND "settledActualMicros" >= 0
    AND "heldMaximumMicros" >= 0
    AND "releasedMicros" >= 0
    AND "acceptedRequestCount" >= 0
  );

CREATE FUNCTION "erp4_knowledge_llm_period_boundary_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  policy_timezone TEXT;
  policy_currency TEXT;
  local_period_start TIMESTAMP;
  expected_period_start_utc TIMESTAMP;
  expected_period_end_utc TIMESTAMP;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."policyId" <> NEW."policyId"
      OR OLD."periodStartUtc" <> NEW."periodStartUtc"
      OR OLD."periodEndUtc" <> NEW."periodEndUtc"
      OR OLD."timezone" <> NEW."timezone"
      OR OLD."currency" <> NEW."currency"
      OR OLD."createdAt" <> NEW."createdAt"
      OR NEW."settledActualMicros" < OLD."settledActualMicros"
      OR NEW."releasedMicros" < OLD."releasedMicros"
      OR NEW."acceptedRequestCount" < OLD."acceptedRequestCount"
      OR NEW."version" <= OLD."version"
    THEN
      RAISE EXCEPTION 'KnowledgeLlmBudgetPeriod boundary or monotonic counter changed'
        USING ERRCODE = '23514';
    END IF;

    -- Policy metadata is immutable for a version and was validated when the
    -- period was inserted. Counter-only settlement updates must not acquire a
    -- period -> policy lock after settlement already locked the period; the
    -- reservation path deliberately uses policy -> period order.
    RETURN NEW;
  END IF;

  SELECT timezone, currency
  INTO policy_timezone, policy_currency
  FROM "KnowledgeLlmBudgetPolicy"
  WHERE id = NEW."policyId"
  FOR SHARE;

  IF NOT FOUND
    OR NEW."timezone" <> policy_timezone
    OR NEW."currency" <> policy_currency
  THEN
    RAISE EXCEPTION 'KnowledgeLlmBudgetPeriod policy metadata mismatch'
      USING ERRCODE = '23514';
  END IF;

  local_period_start :=
    (NEW."periodStartUtc" AT TIME ZONE 'UTC') AT TIME ZONE NEW."timezone";
  expected_period_start_utc :=
    (
      DATE_TRUNC('month', local_period_start)
      AT TIME ZONE NEW."timezone"
    ) AT TIME ZONE 'UTC';
  expected_period_end_utc :=
    (
      (DATE_TRUNC('month', local_period_start) + INTERVAL '1 month')
      AT TIME ZONE NEW."timezone"
    ) AT TIME ZONE 'UTC';

  IF NEW."periodStartUtc" <> expected_period_start_utc
    OR local_period_start <> DATE_TRUNC('month', local_period_start)
    OR NEW."periodEndUtc" <> expected_period_end_utc
  THEN
    RAISE EXCEPTION 'KnowledgeLlmBudgetPeriod monthly boundary mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmBudgetPeriod_boundary_guard"
  BEFORE INSERT OR UPDATE ON "KnowledgeLlmBudgetPeriod"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_period_boundary_guard"();

-- Match ECMAScript TrimString plus the application C0/C1 control and
-- Unicode-code-point length contract. PostgreSQL's one-argument BTRIM only
-- removes U+0020 and is therefore too weak for canonical provider identities.
CREATE OR REPLACE FUNCTION "erp4_knowledge_llm_model_valid"(value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT
    LENGTH(value) BETWEEN 1 AND 200
    AND value = BTRIM(
      value,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    )
    AND value !~ U&'[\0001-\001F\007F-\009F]';
$$;

ALTER TABLE "KnowledgeLlmRun"
  ADD CONSTRAINT "KnowledgeLlmRun_identity_check" CHECK (
    "erp4_knowledge_llm_auth_identifier_valid"("actorUserId", 200)
    AND "erp4_knowledge_llm_model_valid"("model")
    AND "currency" ~ '^[A-Z]{3}$'
    AND "erp4_knowledge_llm_auth_identifier_valid"("createdBy", 200)
    AND "erp4_knowledge_llm_auth_identifier_valid"("updatedBy", 200)
  ),
  ADD CONSTRAINT "KnowledgeLlmRun_scope_check" CHECK (
    ("scope" = 'personal' AND "organizationId" IS NULL)
    OR (
      "scope" = 'organization'
      AND "organizationId" IS NOT NULL
      AND "erp4_knowledge_llm_auth_identifier_valid"("organizationId", 200)
    )
  ),
  ADD CONSTRAINT "KnowledgeLlmRun_request_check" CHECK (
    "catalogVersion" >= 1
    AND "promptTemplateVersion" >= 1
    AND "requestPayloadHash" ~ '^[0-9a-f]{64}$'
    AND "providerRequestHash" ~ '^[0-9a-f]{64}$'
    AND "selectedContextFingerprint" ~ '^[0-9a-f]{64}$'
    AND "estimatedInputTokens" BETWEEN 1 AND 2147483647
    AND "maxOutputTokens" BETWEEN 1 AND 4096
    AND "inputCostMicrosPerMillion" >= 0
    AND "outputCostMicrosPerMillion" >= 0
    AND "maximumCostMicros" >= 0
    AND "maximumCostMicros"::NUMERIC =
      CEIL(
        "estimatedInputTokens"::NUMERIC
        * "inputCostMicrosPerMillion"::NUMERIC
        / 1000000
      )
      + CEIL(
        "maxOutputTokens"::NUMERIC
        * "outputCostMicrosPerMillion"::NUMERIC
        / 1000000
      )
    AND ("actualInputTokens" IS NULL OR "actualInputTokens" >= 0)
    AND ("actualOutputTokens" IS NULL OR "actualOutputTokens" >= 0)
    AND ("actualCostMicros" IS NULL OR (
      "actualCostMicros" >= 0 AND "actualCostMicros" <= "maximumCostMicros"
    ))
  ),
  ADD CONSTRAINT "KnowledgeLlmRun_state_shape_check" CHECK (
    (
      "executionStatus" = 'reserved'
      AND "settlementStatus" = 'reserved'
      AND "failureCode" IS NULL
      AND "dispatchedAt" IS NULL
      AND "completedAt" IS NULL
      AND "conversationId" IS NULL
      AND "assistantTurnId" IS NULL
      AND "actualInputTokens" IS NULL
      AND "actualOutputTokens" IS NULL
      AND "actualCostMicros" IS NULL
    )
    OR (
      "executionStatus" = 'dispatched'
      AND "settlementStatus" = 'reserved'
      AND "failureCode" IS NULL
      AND "dispatchedAt" IS NOT NULL
      AND "completedAt" IS NULL
      AND "conversationId" IS NULL
      AND "assistantTurnId" IS NULL
      AND "actualInputTokens" IS NULL
      AND "actualOutputTokens" IS NULL
      AND "actualCostMicros" IS NULL
    )
    OR (
      "executionStatus" = 'result_ready'
      AND "settlementStatus" IN ('settled_actual', 'held_maximum')
      AND "dispatchedAt" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND "conversationId" IS NOT NULL
      AND "assistantTurnId" IS NOT NULL
      AND (
        (
          "settlementStatus" = 'settled_actual'
          AND "failureCode" IS NULL
          AND "actualInputTokens" IS NOT NULL
          AND "actualOutputTokens" IS NOT NULL
          AND "actualCostMicros" IS NOT NULL
        )
        OR (
          "settlementStatus" = 'held_maximum'
          AND "failureCode" IN ('usage_missing', 'usage_invalid')
          AND "actualInputTokens" IS NULL
          AND "actualOutputTokens" IS NULL
          AND "actualCostMicros" IS NULL
        )
      )
    )
    OR (
      "executionStatus" = 'failed'
      AND "settlementStatus" IN ('released', 'held_maximum')
      AND "failureCode" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND "conversationId" IS NULL
      AND "assistantTurnId" IS NULL
      AND "actualInputTokens" IS NULL
      AND "actualOutputTokens" IS NULL
      AND "actualCostMicros" IS NULL
      AND (
        (
          "settlementStatus" = 'released'
          AND "failureCode" IN ('disabled', 'rejected_before_dispatch')
          AND "dispatchedAt" IS NULL
        )
        OR (
          "settlementStatus" = 'held_maximum'
          AND "failureCode" IN (
            'provider_4xx',
            'provider_5xx',
            'malformed_response',
            'response_oversize',
            'empty_result'
          )
          AND "dispatchedAt" IS NOT NULL
        )
      )
    )
    OR (
      "executionStatus" = 'result_unknown'
      AND "settlementStatus" = 'held_maximum'
      AND "failureCode" IN (
        'timeout_outcome_unknown',
        'connection_outcome_unknown',
        'finalization_failed'
      )
      AND "dispatchedAt" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND "conversationId" IS NULL
      AND "assistantTurnId" IS NULL
      AND "actualInputTokens" IS NULL
      AND "actualOutputTokens" IS NULL
      AND "actualCostMicros" IS NULL
    )
  ),
  ADD CONSTRAINT "KnowledgeLlmRun_timestamp_check" CHECK (
    "updatedAt" >= "createdAt"
    AND ("dispatchedAt" IS NULL OR "dispatchedAt" >= "createdAt")
    AND ("completedAt" IS NULL OR "completedAt" >= COALESCE("dispatchedAt", "createdAt"))
  );

ALTER TABLE "KnowledgeLlmRequest"
  ADD CONSTRAINT "KnowledgeLlmRequest_hash_check" CHECK (
    "requestKeyHash" ~ '^[0-9a-f]{64}$'
    AND "requestPayloadHash" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "KnowledgeLlmRequest_identity_check" CHECK (
    "erp4_knowledge_llm_auth_identifier_valid"("actorUserId", 200)
    AND "erp4_knowledge_llm_auth_identifier_valid"("createdBy", 200)
  );

ALTER TABLE "KnowledgeLlmReservation"
  ADD CONSTRAINT "KnowledgeLlmReservation_amount_check" CHECK (
    "maximumCostMicros" >= 0
    AND (
      "actualCostMicros" IS NULL
      OR (
        "actualCostMicros" >= 0
        AND "actualCostMicros" <= "maximumCostMicros"
      )
    )
  ),
  ADD CONSTRAINT "KnowledgeLlmReservation_state_check" CHECK (
    (
      "status" = 'reserved'
      AND "actualCostMicros" IS NULL
      AND "settledAt" IS NULL
    )
    OR (
      "status" = 'settled_actual'
      AND "actualCostMicros" IS NOT NULL
      AND "settledAt" IS NOT NULL
    )
    OR (
      "status" IN ('released', 'held_maximum')
      AND "actualCostMicros" IS NULL
      AND "settledAt" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "KnowledgeLlmReservation_timestamp_check" CHECK (
    "updatedAt" >= "createdAt"
    AND ("settledAt" IS NULL OR "settledAt" >= "createdAt")
  );

ALTER TABLE "KnowledgeLlmContextSource"
  ADD CONSTRAINT "KnowledgeLlmContextSource_exactly_one_check" CHECK (
    NUM_NONNULLS(
      "sourceSnapshotId",
      "sourceAnnotationRevisionId",
      "sourceConversationTurnId",
      "sourceSynthesisVersionId",
      "sourceThreadPromotionMessageId"
    ) = 1
  ),
  ADD CONSTRAINT "KnowledgeLlmContextSource_type_check" CHECK (
    ("sourceType" = 'snapshot' AND "sourceSnapshotId" IS NOT NULL)
    OR (
      "sourceType" = 'annotation_revision'
      AND "sourceAnnotationRevisionId" IS NOT NULL
    )
    OR (
      "sourceType" = 'conversation_turn'
      AND "sourceConversationTurnId" IS NOT NULL
    )
    OR (
      "sourceType" = 'synthesis_version'
      AND "sourceSynthesisVersionId" IS NOT NULL
    )
    OR (
      "sourceType" = 'thread_promotion_message'
      AND "sourceThreadPromotionMessageId" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "KnowledgeLlmContextSource_bounds_check" CHECK (
    "ordinal" BETWEEN 0 AND 31
    AND "exactSourceVersion" >= 1
    AND "exactSourceHash" ~ '^[0-9a-f]{64}$'
    AND "representationHash" ~ '^[0-9a-f]{64}$'
    AND "byteLength" BETWEEN 1 AND 65536
    AND "estimatedTokens" BETWEEN 1 AND 2147483647
    AND "erp4_knowledge_llm_auth_identifier_valid"("createdBy", 200)
  );

ALTER TABLE "KnowledgeLlmProviderOutcome"
  ADD CONSTRAINT "KnowledgeLlmProviderOutcome_shape_check" CHECK (
    (
      "status" = 'valid'
      AND "contentHash" ~ '^[0-9a-f]{64}$'
      AND "inputTokens" IS NOT NULL
      AND "inputTokens" >= 0
      AND "outputTokens" IS NOT NULL
      AND "outputTokens" >= 0
      AND "failureCode" IS NULL
      AND (
        ("finalizedAt" IS NULL AND "normalizedContent" IS NOT NULL)
        OR ("finalizedAt" IS NOT NULL AND "normalizedContent" IS NULL)
      )
    )
    OR (
      "status" = 'usage_unknown'
      AND "contentHash" ~ '^[0-9a-f]{64}$'
      AND "inputTokens" IS NULL
      AND "outputTokens" IS NULL
      AND "failureCode" IN ('usage_missing', 'usage_invalid')
      AND (
        ("finalizedAt" IS NULL AND "normalizedContent" IS NOT NULL)
        OR ("finalizedAt" IS NOT NULL AND "normalizedContent" IS NULL)
      )
    )
    OR (
      "status" = 'invalid'
      AND "normalizedContent" IS NULL
      AND "contentHash" IS NULL
      AND "inputTokens" IS NULL
      AND "outputTokens" IS NULL
      AND "failureCode" IS NOT NULL
      AND "finalizedAt" IS NULL
    )
  ),
  ADD CONSTRAINT "KnowledgeLlmProviderOutcome_content_bound_check" CHECK (
    "normalizedContent" IS NULL
    OR OCTET_LENGTH("normalizedContent") BETWEEN 1 AND 262144
  ),
  ADD CONSTRAINT "KnowledgeLlmProviderOutcome_timestamp_check" CHECK (
    "capturedAt" >= "createdAt"
    AND ("finalizedAt" IS NULL OR "finalizedAt" >= "capturedAt")
  );

ALTER TABLE "KnowledgeLlmUsageEvidence"
  ADD CONSTRAINT "KnowledgeLlmUsageEvidence_shape_check" CHECK (
    "inputTokens" >= 0
    AND "outputTokens" >= 0
    AND "actualCostMicros" >= 0
    AND "evidenceHash" ~ '^[0-9a-f]{64}$'
    AND "erp4_knowledge_llm_auth_identifier_valid"("createdBy", 200)
  );

CREATE FUNCTION "erp4_knowledge_llm_immutable_row"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "KnowledgeLlmRequest_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeLlmRequest"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_immutable_row"();

CREATE FUNCTION "erp4_knowledge_llm_context_source_insert_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  run_execution "KnowledgeLlmExecutionStatus";
BEGIN
  SELECT "executionStatus"
  INTO run_execution
  FROM "KnowledgeLlmRun"
  WHERE id = NEW."runId"
  FOR UPDATE;

  IF run_execution IS NULL OR run_execution <> 'reserved' THEN
    RAISE EXCEPTION 'KnowledgeLlmContextSource cannot change after dispatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmContextSource_before_dispatch_only"
  BEFORE INSERT ON "KnowledgeLlmContextSource"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_context_source_insert_guard"();

CREATE TRIGGER "KnowledgeLlmContextSource_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeLlmContextSource"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_immutable_row"();

CREATE FUNCTION "erp4_knowledge_llm_text_hash"(domain TEXT, content TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT encode(
    sha256(
      convert_to('erp4:knowledge:' || domain || ':v1', 'UTF8')
      || decode('00', 'hex')
      || convert_to(content, 'UTF8')
    ),
    'hex'
  )
$$;

CREATE FUNCTION "erp4_knowledge_llm_context_source_fingerprint"(
  source_type "KnowledgeLlmContextSourceType",
  source_ordinal INTEGER,
  source_id TEXT,
  source_version INTEGER,
  source_hash TEXT,
  representation_hash TEXT,
  byte_length INTEGER,
  estimated_tokens INTEGER
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT encode(
    sha256(
      convert_to('erp4:knowledge:llm-context-source:v1', 'UTF8')
      || decode('00', 'hex')
      || convert_to(OCTET_LENGTH(source_ordinal::TEXT)::TEXT || ':' || source_ordinal::TEXT, 'UTF8')
      || convert_to(OCTET_LENGTH(source_type::TEXT)::TEXT || ':' || source_type::TEXT, 'UTF8')
      || convert_to(OCTET_LENGTH(source_id)::TEXT || ':' || source_id, 'UTF8')
      || convert_to(OCTET_LENGTH(source_version::TEXT)::TEXT || ':' || source_version::TEXT, 'UTF8')
      || convert_to(OCTET_LENGTH(source_hash)::TEXT || ':' || source_hash, 'UTF8')
      || convert_to(OCTET_LENGTH(representation_hash)::TEXT || ':' || representation_hash, 'UTF8')
      || convert_to(OCTET_LENGTH(byte_length::TEXT)::TEXT || ':' || byte_length::TEXT, 'UTF8')
      || convert_to(OCTET_LENGTH(estimated_tokens::TEXT)::TEXT || ':' || estimated_tokens::TEXT, 'UTF8')
    ),
    'hex'
  )
$$;

CREATE FUNCTION "erp4_knowledge_llm_context_fingerprint"(target_run_id TEXT)
RETURNS TEXT
LANGUAGE SQL
STABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT encode(
    sha256(
      convert_to('erp4:knowledge:llm-context-fingerprint:v1', 'UTF8')
      || decode('00', 'hex')
      || convert_to(
        COALESCE(
          STRING_AGG(
            "erp4_knowledge_llm_context_source_fingerprint"(
              source."sourceType",
              source.ordinal,
              CASE source."sourceType"
                WHEN 'snapshot' THEN source."sourceSnapshotId"
                WHEN 'annotation_revision' THEN source."sourceAnnotationRevisionId"
                WHEN 'conversation_turn' THEN source."sourceConversationTurnId"
                WHEN 'synthesis_version' THEN source."sourceSynthesisVersionId"
                WHEN 'thread_promotion_message' THEN source."sourceThreadPromotionMessageId"
              END,
              source."exactSourceVersion",
              source."exactSourceHash",
              source."representationHash",
              source."byteLength",
              source."estimatedTokens"
            ),
            '' ORDER BY source.ordinal
          ),
          ''
        ),
        'UTF8'
      )
    ),
    'hex'
  )
  FROM "KnowledgeLlmContextSource" source
  WHERE source."runId" = target_run_id
$$;

CREATE FUNCTION "erp4_knowledge_llm_validate_context"(
  target_run_id TEXT,
  expected_fingerprint TEXT,
  run_estimated_tokens INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  source_count INTEGER;
  snapshot_count INTEGER;
  annotation_count INTEGER;
  conversation_count INTEGER;
  synthesis_count INTEGER;
  promotion_count INTEGER;
  context_bytes BIGINT;
  context_tokens BIGINT;
  selected_item_count INTEGER;
BEGIN
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE "sourceType" = 'snapshot')::INTEGER,
    COUNT(*) FILTER (WHERE "sourceType" = 'annotation_revision')::INTEGER,
    COUNT(*) FILTER (WHERE "sourceType" = 'conversation_turn')::INTEGER,
    COUNT(*) FILTER (WHERE "sourceType" = 'synthesis_version')::INTEGER,
    COUNT(*) FILTER (WHERE "sourceType" = 'thread_promotion_message')::INTEGER,
    COALESCE(SUM("byteLength"), 0),
    COALESCE(SUM("estimatedTokens"), 0)
  INTO source_count, snapshot_count, annotation_count, conversation_count,
    synthesis_count, promotion_count, context_bytes, context_tokens
  FROM "KnowledgeLlmContextSource"
  WHERE "runId" = target_run_id;

  IF source_count > 32
    OR snapshot_count > 4
    OR annotation_count > 10
    OR conversation_count > 20
    OR synthesis_count > 5
    OR promotion_count > 20
    OR context_bytes > 262144
    OR context_tokens + 64 > run_estimated_tokens
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun dispatch context bounds exceeded'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "KnowledgeLlmContextSource" source
    LEFT JOIN "KnowledgeSnapshot" snapshot
      ON snapshot.id = source."sourceSnapshotId"
    LEFT JOIN "KnowledgeAnnotationRevision" annotation_revision
      ON annotation_revision.id = source."sourceAnnotationRevisionId"
    LEFT JOIN "KnowledgeConversationTurn" conversation_turn
      ON conversation_turn.id = source."sourceConversationTurnId"
    LEFT JOIN "KnowledgeSynthesisVersion" synthesis_version
      ON synthesis_version.id = source."sourceSynthesisVersionId"
    LEFT JOIN "KnowledgeThreadPromotionMessage" promotion_message
      ON promotion_message.id = source."sourceThreadPromotionMessageId"
    WHERE source."runId" = target_run_id
      AND NOT (
        (
          source."sourceType" = 'snapshot'
          AND snapshot.id IS NOT NULL
          AND snapshot.status = 'ready'
          AND snapshot.sha256 IS NOT NULL
          AND snapshot."extractedText" IS NOT NULL
          AND source."exactSourceVersion" = snapshot.version
          AND source."exactSourceHash" = snapshot.sha256
          AND source."representationHash" =
            "erp4_knowledge_llm_text_hash"('llm-context-representation', snapshot."extractedText")
          AND source."byteLength" = OCTET_LENGTH(snapshot."extractedText")
          AND source."estimatedTokens" = source."byteLength" * 2 + 16
        )
        OR (
          source."sourceType" = 'annotation_revision'
          AND annotation_revision.id IS NOT NULL
          AND source."exactSourceVersion" = annotation_revision.revision
          AND source."exactSourceHash" =
            "erp4_knowledge_llm_text_hash"('annotation-revision', annotation_revision.content)
          AND source."representationHash" =
            "erp4_knowledge_llm_text_hash"('llm-context-representation', annotation_revision.content)
          AND source."byteLength" = OCTET_LENGTH(annotation_revision.content)
          AND source."estimatedTokens" = source."byteLength" * 2 + 16
        )
        OR (
          source."sourceType" = 'conversation_turn'
          AND conversation_turn.id IS NOT NULL
          AND source."exactSourceVersion" = conversation_turn.sequence
          AND source."exactSourceHash" = conversation_turn."contentHash"
          AND conversation_turn."contentHash" =
            "erp4_knowledge_llm_text_hash"('conversation-turn', conversation_turn.content)
          AND source."representationHash" =
            "erp4_knowledge_llm_text_hash"('llm-context-representation', conversation_turn.content)
          AND source."byteLength" = OCTET_LENGTH(conversation_turn.content)
          AND source."estimatedTokens" = source."byteLength" * 2 + 16
        )
        OR (
          source."sourceType" = 'synthesis_version'
          AND synthesis_version.id IS NOT NULL
          AND source."exactSourceVersion" = synthesis_version.version
          AND source."exactSourceHash" =
            "erp4_knowledge_llm_text_hash"('synthesis-version', synthesis_version.content)
          AND source."representationHash" =
            "erp4_knowledge_llm_text_hash"('llm-context-representation', synthesis_version.content)
          AND source."byteLength" = OCTET_LENGTH(synthesis_version.content)
          AND source."estimatedTokens" = source."byteLength" * 2 + 16
        )
        OR (
          source."sourceType" = 'thread_promotion_message'
          AND promotion_message.id IS NOT NULL
          AND source."exactSourceVersion" = promotion_message.ordinal + 1
          AND source."exactSourceHash" = promotion_message."contentHash"
          AND source."representationHash" =
            "erp4_knowledge_llm_text_hash"('llm-context-representation', promotion_message.content)
          AND source."byteLength" = OCTET_LENGTH(promotion_message.content)
          AND source."estimatedTokens" = source."byteLength" * 2 + 16
        )
      )
  ) THEN
    RAISE EXCEPTION 'KnowledgeLlmRun dispatch context provenance is stale or invalid'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "KnowledgeLlmContextSource" source
    JOIN "KnowledgeSynthesisSource" provenance
      ON provenance."synthesisVersionId" = source."sourceSynthesisVersionId"
    WHERE source."runId" = target_run_id
      AND source."sourceType" = 'synthesis_version'
      AND (
        provenance."sourceSynthesisVersionId" IS NOT NULL
        OR provenance."sourceThreadPromotionId" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'KnowledgeLlmRun dispatch context provenance depth exceeded'
      USING ERRCODE = '23514';
  END IF;

  WITH selected_items AS (
    SELECT snapshot."knowledgeItemId" AS id
    FROM "KnowledgeLlmContextSource" source
    JOIN "KnowledgeSnapshot" snapshot ON snapshot.id = source."sourceSnapshotId"
    WHERE source."runId" = target_run_id
    UNION
    SELECT annotation."knowledgeItemId"
    FROM "KnowledgeLlmContextSource" source
    JOIN "KnowledgeAnnotationRevision" revision
      ON revision.id = source."sourceAnnotationRevisionId"
    JOIN "KnowledgeAnnotation" annotation ON annotation.id = revision."annotationId"
    WHERE source."runId" = target_run_id
    UNION
    SELECT item."knowledgeItemId"
    FROM "KnowledgeLlmContextSource" source
    JOIN "KnowledgeConversationTurn" turn
      ON turn.id = source."sourceConversationTurnId"
    JOIN "KnowledgeConversationItem" item
      ON item."conversationId" = turn."conversationId"
    WHERE source."runId" = target_run_id
    UNION
    SELECT synthesis_item.id
    FROM "KnowledgeLlmContextSource" source
    JOIN "KnowledgeSynthesisSource" provenance
      ON provenance."synthesisVersionId" = source."sourceSynthesisVersionId"
    CROSS JOIN LATERAL (
      SELECT provenance."sourceKnowledgeItemId" AS id
      UNION SELECT snapshot."knowledgeItemId"
        FROM "KnowledgeSnapshot" snapshot
        WHERE snapshot.id = provenance."sourceSnapshotId"
      UNION SELECT annotation."knowledgeItemId"
        FROM "KnowledgeAnnotation" annotation
        WHERE annotation.id = provenance."sourceAnnotationId"
      UNION SELECT revision_annotation."knowledgeItemId"
        FROM "KnowledgeAnnotationRevision" revision
        JOIN "KnowledgeAnnotation" revision_annotation
          ON revision_annotation.id = revision."annotationId"
        WHERE revision.id = provenance."sourceAnnotationRevisionId"
      UNION SELECT item."knowledgeItemId"
        FROM "KnowledgeConversationItem" item
        WHERE item."conversationId" = provenance."sourceConversationId"
      UNION SELECT item."knowledgeItemId"
        FROM "KnowledgeConversationTurn" turn
        JOIN "KnowledgeConversationItem" item
          ON item."conversationId" = turn."conversationId"
        WHERE turn.id = provenance."sourceConversationTurnId"
    ) synthesis_item
    WHERE source."runId" = target_run_id
      AND synthesis_item.id IS NOT NULL
    UNION
    SELECT share."sourceKnowledgeItemId"
    FROM "KnowledgeLlmContextSource" source
    JOIN "KnowledgeThreadPromotionMessage" message
      ON message.id = source."sourceThreadPromotionMessageId"
    JOIN "KnowledgeThreadPromotion" promotion
      ON promotion.id = message."promotionId"
    JOIN "KnowledgeShare" share ON share.id = promotion."sourceShareId"
    WHERE source."runId" = target_run_id
  )
  SELECT COUNT(*)::INTEGER INTO selected_item_count FROM selected_items;

  IF selected_item_count > 10 THEN
    RAISE EXCEPTION 'KnowledgeLlmRun dispatch selected item bound exceeded'
      USING ERRCODE = '23514';
  END IF;

  IF expected_fingerprint <>
    "erp4_knowledge_llm_context_fingerprint"(target_run_id)
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun dispatch context fingerprint mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "erp4_knowledge_llm_run_transition_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_actual_cost NUMERIC;
BEGIN
  IF OLD."executionStatus" = 'reserved'
    AND NEW."executionStatus" = 'dispatched'
  THEN
    PERFORM "erp4_knowledge_llm_validate_context"(
      NEW.id,
      NEW."selectedContextFingerprint",
      NEW."estimatedInputTokens"
    );
  END IF;

  IF OLD."executionStatus" = 'reserved'
    AND NEW."executionStatus" = 'dispatched'
    AND EXISTS (
      SELECT 1
      FROM (
        SELECT COUNT(*) AS source_count,
          MIN(ordinal) AS minimum_ordinal,
          MAX(ordinal) AS maximum_ordinal
        FROM "KnowledgeLlmContextSource"
        WHERE "runId" = NEW.id
      ) source_set
      WHERE source_set.source_count > 0
        AND (
          source_set.minimum_ordinal <> 0
          OR source_set.maximum_ordinal <> source_set.source_count - 1
        )
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun dispatch requires contiguous context sources'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."settlementStatus" = 'settled_actual' THEN
    IF NEW."actualInputTokens" IS NULL
      OR NEW."actualOutputTokens" IS NULL
      OR NEW."actualCostMicros" IS NULL
    THEN
      RAISE EXCEPTION 'KnowledgeLlmRun actual settlement requires usage and cost'
        USING ERRCODE = '23514';
    END IF;
    expected_actual_cost :=
      CEIL(
        NEW."actualInputTokens"::NUMERIC
        * OLD."inputCostMicrosPerMillion"::NUMERIC
        / 1000000
      )
      + CEIL(
        NEW."actualOutputTokens"::NUMERIC
        * OLD."outputCostMicrosPerMillion"::NUMERIC
        / 1000000
      );
    IF NEW."actualCostMicros"::NUMERIC <> expected_actual_cost THEN
      RAISE EXCEPTION 'KnowledgeLlmRun actual settlement cost mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."executionStatus" = 'result_ready'
    AND NOT EXISTS (
      SELECT 1
      FROM "KnowledgeConversationTurn" turn
      WHERE turn.id = NEW."assistantTurnId"
        AND turn."conversationId" = NEW."conversationId"
        AND turn.role = 'assistant'
        AND turn.origin = 'ai'
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun result requires an assistant AI turn'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."executionStatus" = 'result_ready'
    AND NEW."settlementStatus" = 'settled_actual'
    AND NOT (
      EXISTS (
        SELECT 1
        FROM "KnowledgeLlmProviderOutcome" outcome
        JOIN "KnowledgeConversationTurn" turn
          ON turn.id = NEW."assistantTurnId"
         AND turn."conversationId" = NEW."conversationId"
        WHERE outcome."runId" = NEW.id
          AND outcome.status = 'valid'
          AND outcome."finalizedAt" IS NOT NULL
          AND outcome."normalizedContent" IS NULL
          AND outcome."inputTokens" = NEW."actualInputTokens"
          AND outcome."outputTokens" = NEW."actualOutputTokens"
          AND outcome."contentHash" = turn."contentHash"
          AND outcome."contentHash" =
            "erp4_knowledge_llm_content_hash"(turn.content)
          AND turn.role = 'assistant'
          AND turn.origin = 'ai'
          AND NEW."completedAt" >= outcome."finalizedAt"
      )
      OR EXISTS (
        SELECT 1
        FROM "KnowledgeLlmUsageEvidence" evidence
        JOIN "KnowledgeLlmProviderOutcome" outcome
          ON outcome."runId" = evidence."runId"
        JOIN "KnowledgeConversationTurn" turn
          ON turn.id = NEW."assistantTurnId"
         AND turn."conversationId" = NEW."conversationId"
        WHERE evidence."runId" = NEW.id
          AND evidence."inputTokens" = NEW."actualInputTokens"
          AND evidence."outputTokens" = NEW."actualOutputTokens"
          AND evidence."actualCostMicros" = NEW."actualCostMicros"
          AND evidence."createdAt" <= NEW."completedAt"
          AND outcome.status = 'usage_unknown'
          AND outcome."finalizedAt" IS NOT NULL
          AND outcome."normalizedContent" IS NULL
          AND outcome."contentHash" = turn."contentHash"
          AND outcome."contentHash" =
            "erp4_knowledge_llm_content_hash"(turn.content)
          AND turn.role = 'assistant'
          AND turn.origin = 'ai'
      )
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun settlement requires a valid provider outcome or usage evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."executionStatus" = 'result_ready'
    AND NEW."settlementStatus" = 'held_maximum'
    AND NOT EXISTS (
      SELECT 1
      FROM "KnowledgeLlmProviderOutcome" outcome
      JOIN "KnowledgeConversationTurn" turn
        ON turn.id = NEW."assistantTurnId"
       AND turn."conversationId" = NEW."conversationId"
      WHERE outcome."runId" = NEW.id
        AND outcome.status = 'usage_unknown'
        AND outcome."failureCode" = NEW."failureCode"
        AND outcome."finalizedAt" IS NOT NULL
        AND outcome."normalizedContent" IS NULL
        AND outcome."contentHash" = turn."contentHash"
        AND outcome."contentHash" =
          "erp4_knowledge_llm_content_hash"(turn.content)
        AND turn.role = 'assistant'
        AND turn.origin = 'ai'
        AND NEW."completedAt" >= outcome."finalizedAt"
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun held result requires a usage-unknown provider outcome'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."executionStatus" <> NEW."executionStatus" AND NOT (
    (OLD."executionStatus" = 'reserved' AND NEW."executionStatus" IN ('dispatched', 'failed'))
    OR (
      OLD."executionStatus" = 'dispatched'
      AND NEW."executionStatus" IN ('result_ready', 'failed', 'result_unknown')
    )
    OR (
      OLD."executionStatus" = 'result_unknown'
      AND NEW."executionStatus" = 'result_ready'
    )
  ) THEN
    RAISE EXCEPTION 'invalid KnowledgeLlmRun execution transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."settlementStatus" <> NEW."settlementStatus" AND NOT (
    (
      OLD."settlementStatus" = 'reserved'
      AND NEW."settlementStatus" IN ('settled_actual', 'released', 'held_maximum')
    )
    OR (
      OLD."settlementStatus" = 'held_maximum'
      AND NEW."settlementStatus" = 'settled_actual'
    )
  ) THEN
    RAISE EXCEPTION 'invalid KnowledgeLlmRun settlement transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."actorUserId" <> NEW."actorUserId"
    OR OLD."scope" <> NEW."scope"
    OR OLD."organizationId" IS DISTINCT FROM NEW."organizationId"
    OR OLD."provider" <> NEW."provider"
    OR OLD."model" <> NEW."model"
    OR OLD."catalogVersion" <> NEW."catalogVersion"
    OR OLD."promptTemplateVersion" <> NEW."promptTemplateVersion"
    OR OLD."requestPayloadHash" <> NEW."requestPayloadHash"
    OR OLD."providerRequestHash" <> NEW."providerRequestHash"
    OR OLD."selectedContextFingerprint" <> NEW."selectedContextFingerprint"
    OR OLD."estimatedInputTokens" <> NEW."estimatedInputTokens"
    OR OLD."maxOutputTokens" <> NEW."maxOutputTokens"
    OR OLD."inputCostMicrosPerMillion" <> NEW."inputCostMicrosPerMillion"
    OR OLD."outputCostMicrosPerMillion" <> NEW."outputCostMicrosPerMillion"
    OR OLD."maximumCostMicros" <> NEW."maximumCostMicros"
    OR OLD."softLimitWarning" <> NEW."softLimitWarning"
    OR OLD."currency" <> NEW."currency"
    OR OLD."createdAt" <> NEW."createdAt"
    OR OLD."createdBy" <> NEW."createdBy"
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun request boundary is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."dispatchedAt" IS NOT NULL
    AND OLD."dispatchedAt" IS DISTINCT FROM NEW."dispatchedAt"
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun dispatch timestamp is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."conversationId" IS DISTINCT FROM NEW."conversationId"
    AND NOT (
      NEW."executionStatus" = 'result_ready'
      AND NEW."conversationId" IS NOT NULL
      AND (
        OLD."executionStatus" = 'dispatched'
        OR OLD."executionStatus" = 'result_unknown'
      )
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun conversation requires result transition'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."dispatchedAt" IS NULL
    AND NEW."dispatchedAt" IS NOT NULL
    AND NOT (
      OLD."executionStatus" = 'reserved'
      AND NEW."executionStatus" = 'dispatched'
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun dispatch timestamp requires dispatch transition'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NOT (
    (
      OLD."executionStatus" = 'result_unknown'
      AND OLD."settlementStatus" = 'held_maximum'
      AND NEW."executionStatus" = 'result_ready'
      AND NEW."settlementStatus" = 'settled_actual'
      AND OLD."failureCode" IN ('finalization_failed', 'timeout_outcome_unknown', 'connection_outcome_unknown')
      AND NEW."failureCode" IS NULL
      AND NEW."conversationId" IS NOT NULL
      AND NEW."assistantTurnId" IS NOT NULL
      AND NEW."actualInputTokens" IS NOT NULL
      AND NEW."actualOutputTokens" IS NOT NULL
      AND NEW."actualCostMicros" IS NOT NULL
      AND NEW."completedAt" >= OLD."completedAt"
      AND EXISTS (
        SELECT 1
        FROM "KnowledgeLlmProviderOutcome" outcome
        JOIN "KnowledgeConversationTurn" turn
          ON turn.id = NEW."assistantTurnId"
         AND turn."conversationId" = NEW."conversationId"
        WHERE outcome."runId" = OLD.id
          AND outcome.status = 'valid'
          AND outcome."finalizedAt" IS NOT NULL
          AND outcome."normalizedContent" IS NULL
          AND outcome."inputTokens" = NEW."actualInputTokens"
          AND outcome."outputTokens" = NEW."actualOutputTokens"
          AND outcome."contentHash" = turn."contentHash"
          AND outcome."contentHash" =
            "erp4_knowledge_llm_content_hash"(turn.content)
          AND turn.role = 'assistant'
          AND turn.origin = 'ai'
          AND NEW."completedAt" >= outcome."finalizedAt"
      )
    )
    OR (
      OLD."executionStatus" = 'result_ready'
      AND OLD."settlementStatus" = 'held_maximum'
      AND OLD."failureCode" IN ('usage_missing', 'usage_invalid')
      AND NEW."executionStatus" = 'result_ready'
      AND NEW."settlementStatus" = 'settled_actual'
      AND NEW."failureCode" IS NULL
      AND NEW."conversationId" = OLD."conversationId"
      AND NEW."assistantTurnId" = OLD."assistantTurnId"
      AND NEW."actualInputTokens" IS NOT NULL
      AND NEW."actualOutputTokens" IS NOT NULL
      AND NEW."actualCostMicros" IS NOT NULL
      AND NEW."completedAt" >= OLD."completedAt"
      AND EXISTS (
        SELECT 1
        FROM "KnowledgeLlmUsageEvidence" evidence
        WHERE evidence."runId" = OLD.id
          AND evidence."inputTokens" = NEW."actualInputTokens"
          AND evidence."outputTokens" = NEW."actualOutputTokens"
          AND evidence."actualCostMicros" = NEW."actualCostMicros"
          AND evidence."createdAt" <= NEW."completedAt"
      )
    )
  ) THEN
    IF OLD."failureCode" IS DISTINCT FROM NEW."failureCode"
      OR OLD."conversationId" IS DISTINCT FROM NEW."conversationId"
      OR OLD."assistantTurnId" IS DISTINCT FROM NEW."assistantTurnId"
      OR OLD."actualInputTokens" IS DISTINCT FROM NEW."actualInputTokens"
      OR OLD."actualOutputTokens" IS DISTINCT FROM NEW."actualOutputTokens"
      OR OLD."actualCostMicros" IS DISTINCT FROM NEW."actualCostMicros"
      OR OLD."completedAt" IS DISTINCT FROM NEW."completedAt"
    THEN
      RAISE EXCEPTION 'terminal KnowledgeLlmRun outcome is immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."executionStatus" = NEW."executionStatus"
    AND OLD."settlementStatus" = NEW."settlementStatus"
    AND (
      OLD."updatedAt" IS DISTINCT FROM NEW."updatedAt"
      OR OLD."updatedBy" IS DISTINCT FROM NEW."updatedBy"
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun provenance updates require a state transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmRun_transition_guard"
  BEFORE UPDATE ON "KnowledgeLlmRun"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_run_transition_guard"();

CREATE FUNCTION "erp4_knowledge_llm_reservation_transition_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  run_execution "KnowledgeLlmExecutionStatus";
  run_settlement "KnowledgeLlmSettlementStatus";
  run_scope "KnowledgeLlmRunScope";
  run_actor TEXT;
  run_organization TEXT;
  run_currency TEXT;
  run_maximum BIGINT;
  run_actual BIGINT;
  run_created_at TIMESTAMP(3);
  run_dispatched_at TIMESTAMP(3);
  run_completed_at TIMESTAMP(3);
  period_start TIMESTAMP(3);
  period_end TIMESTAMP(3);
  period_currency TEXT;
  policy_subject_type "KnowledgeLlmBudgetSubjectType";
  policy_subject_id TEXT;
  policy_active BOOLEAN;
  duplicate_subject_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "executionStatus", "settlementStatus", scope, "actorUserId",
      "organizationId", currency, "maximumCostMicros", "createdAt",
      "dispatchedAt"
    INTO run_execution, run_settlement, run_scope, run_actor,
      run_organization, run_currency, run_maximum, run_created_at,
      run_dispatched_at
    FROM "KnowledgeLlmRun"
    WHERE id = NEW."runId"
    FOR UPDATE;

    SELECT period."periodStartUtc", period."periodEndUtc", period.currency,
      policy."subjectType", policy."subjectId", policy.active
    INTO period_start, period_end, period_currency, policy_subject_type,
      policy_subject_id, policy_active
    FROM "KnowledgeLlmBudgetPeriod" period
    JOIN "KnowledgeLlmBudgetPolicy" policy ON policy.id = period."policyId"
    WHERE period.id = NEW."budgetPeriodId"
    FOR UPDATE OF period, policy;

    IF run_execution IS NULL
      OR period_start IS NULL
      OR run_execution <> 'reserved'
      OR run_settlement <> 'reserved'
      OR run_dispatched_at IS NOT NULL
      OR NEW.status <> 'reserved'
      OR NEW."actualCostMicros" IS NOT NULL
      OR NEW."settledAt" IS NOT NULL
      OR NEW."maximumCostMicros" <> run_maximum
      OR NEW."createdAt" <> run_created_at
      OR NEW."updatedAt" <> NEW."createdAt"
      OR NEW."createdAt" < period_start
      OR NEW."createdAt" >= period_end
      OR period_currency <> run_currency
      OR NOT policy_active
      OR NOT (
        (
          policy_subject_type = 'user'
          AND policy_subject_id = run_actor
        )
        OR (
          run_scope = 'organization'
          AND policy_subject_type = 'organization'
          AND policy_subject_id = run_organization
        )
      )
    THEN
      RAISE EXCEPTION 'KnowledgeLlmReservation must be created with its initial run and matching budget subject'
        USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO duplicate_subject_count
    FROM "KnowledgeLlmReservation" reservation
    JOIN "KnowledgeLlmBudgetPeriod" existing_period
      ON existing_period.id = reservation."budgetPeriodId"
    JOIN "KnowledgeLlmBudgetPolicy" existing_policy
      ON existing_policy.id = existing_period."policyId"
    WHERE reservation."runId" = NEW."runId"
      AND existing_policy."subjectType" = policy_subject_type;

    IF duplicate_subject_count <> 0 THEN
      RAISE EXCEPTION 'KnowledgeLlmReservation budget subject already reserved'
        USING ERRCODE = '23514';
    END IF;

    UPDATE "KnowledgeLlmBudgetPeriod"
    SET "activeReservedMicros" = "activeReservedMicros" + NEW."maximumCostMicros",
      "acceptedRequestCount" = "acceptedRequestCount" + 1,
      version = version + 1,
      "updatedAt" = GREATEST("updatedAt", NEW."updatedAt")
    WHERE id = NEW."budgetPeriodId";

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'KnowledgeLlmReservation cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  SELECT "executionStatus", "settlementStatus", scope, "actorUserId",
    "organizationId", currency, "maximumCostMicros", "actualCostMicros",
    "createdAt", "dispatchedAt", "completedAt"
  INTO run_execution, run_settlement, run_scope, run_actor,
    run_organization, run_currency, run_maximum, run_actual,
    run_created_at, run_dispatched_at, run_completed_at
  FROM "KnowledgeLlmRun"
  WHERE id = NEW."runId"
  FOR UPDATE;

  IF OLD."runId" <> NEW."runId"
    OR OLD."budgetPeriodId" <> NEW."budgetPeriodId"
    OR OLD."maximumCostMicros" <> NEW."maximumCostMicros"
    OR OLD."createdAt" <> NEW."createdAt"
  THEN
    RAISE EXCEPTION 'KnowledgeLlmReservation boundary is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> NEW."status" AND NOT (
    (
      OLD."status" = 'reserved'
      AND NEW."status" IN ('settled_actual', 'released', 'held_maximum')
    )
    OR (
      OLD."status" = 'held_maximum'
      AND NEW."status" = 'settled_actual'
    )
  ) THEN
    RAISE EXCEPTION 'invalid KnowledgeLlmReservation transition'
      USING ERRCODE = '23514';
  END IF;
  IF (
      OLD."status" IN ('settled_actual', 'released')
      AND (
        OLD."status" <> NEW."status"
        OR OLD."actualCostMicros" IS DISTINCT FROM NEW."actualCostMicros"
        OR OLD."settledAt" IS DISTINCT FROM NEW."settledAt"
      )
    )
    OR (
      OLD."status" = 'held_maximum'
      AND NEW."status" = 'held_maximum'
      AND (
        OLD."actualCostMicros" IS DISTINCT FROM NEW."actualCostMicros"
        OR OLD."settledAt" IS DISTINCT FROM NEW."settledAt"
      )
    )
    OR (
      OLD."status" = 'held_maximum'
      AND NEW."status" = 'settled_actual'
      AND NEW."settledAt" < OLD."settledAt"
    )
  THEN
    RAISE EXCEPTION 'terminal KnowledgeLlmReservation accounting is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = NEW."status" THEN
    RAISE EXCEPTION 'KnowledgeLlmReservation can change only with run settlement'
      USING ERRCODE = '23514';
  END IF;
  IF run_settlement IS NULL
    OR NEW."status" <> run_settlement
    OR NEW."maximumCostMicros" <> run_maximum
    OR NEW."settledAt" IS DISTINCT FROM run_completed_at
    OR NEW."updatedAt" IS DISTINCT FROM NEW."settledAt"
    OR (
      NEW."status" = 'settled_actual'
      AND (
        run_actual IS NULL
        OR NEW."actualCostMicros" IS DISTINCT FROM run_actual
      )
    )
    OR (
      NEW."status" IN ('released', 'held_maximum')
      AND NEW."actualCostMicros" IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmReservation settlement must match its terminal run'
      USING ERRCODE = '23514';
  END IF;

  UPDATE "KnowledgeLlmBudgetPeriod"
  SET "activeReservedMicros" = "activeReservedMicros"
        - CASE WHEN OLD.status = 'reserved' THEN OLD."maximumCostMicros" ELSE 0 END,
    "heldMaximumMicros" = "heldMaximumMicros"
        - CASE WHEN OLD.status = 'held_maximum' THEN OLD."maximumCostMicros" ELSE 0 END
        + CASE WHEN NEW.status = 'held_maximum' THEN NEW."maximumCostMicros" ELSE 0 END,
    "settledActualMicros" = "settledActualMicros"
        + CASE WHEN NEW.status = 'settled_actual' THEN NEW."actualCostMicros" ELSE 0 END,
    "releasedMicros" = "releasedMicros"
        + CASE
            WHEN NEW.status = 'released' THEN NEW."maximumCostMicros"
            WHEN NEW.status = 'settled_actual'
              THEN NEW."maximumCostMicros" - NEW."actualCostMicros"
            ELSE 0
          END,
    version = version + 1,
    "updatedAt" = GREATEST("updatedAt", NEW."updatedAt")
  WHERE id = NEW."budgetPeriodId";

  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmReservation_transition_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "KnowledgeLlmReservation"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_reservation_transition_guard"();

CREATE FUNCTION "erp4_knowledge_llm_assert_run_reservation_consistency"(
  target_run_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  run_scope "KnowledgeLlmRunScope";
  run_settlement "KnowledgeLlmSettlementStatus";
  run_maximum BIGINT;
  run_actual BIGINT;
  run_completed_at TIMESTAMP(3);
  expected_count INTEGER;
  reservation_count INTEGER;
  mismatched_count INTEGER;
BEGIN
  SELECT scope, "settlementStatus", "maximumCostMicros", "actualCostMicros",
    "completedAt"
  INTO run_scope, run_settlement, run_maximum, run_actual, run_completed_at
  FROM "KnowledgeLlmRun"
  WHERE id = target_run_id;

  IF run_scope IS NULL THEN
    RETURN;
  END IF;

  expected_count := CASE WHEN run_scope = 'personal' THEN 1 ELSE 2 END;
  SELECT COUNT(*)::INTEGER,
    COUNT(*) FILTER (
      WHERE reservation.status <> run_settlement
        OR reservation."maximumCostMicros" <> run_maximum
        OR (
          run_settlement = 'reserved'
          AND (
            reservation."actualCostMicros" IS NOT NULL
            OR reservation."settledAt" IS NOT NULL
          )
        )
        OR (
          run_settlement = 'settled_actual'
          AND (
            reservation."actualCostMicros" IS DISTINCT FROM run_actual
            OR reservation."settledAt" IS DISTINCT FROM run_completed_at
          )
        )
        OR (
          run_settlement IN ('released', 'held_maximum')
          AND (
            reservation."actualCostMicros" IS NOT NULL
            OR reservation."settledAt" IS DISTINCT FROM run_completed_at
          )
        )
    )::INTEGER
  INTO reservation_count, mismatched_count
  FROM "KnowledgeLlmReservation" reservation
  WHERE reservation."runId" = target_run_id;

  IF reservation_count <> expected_count OR mismatched_count <> 0 THEN
    RAISE EXCEPTION 'KnowledgeLlmRun and reservations must settle atomically'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "erp4_knowledge_llm_run_reservation_consistency_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "erp4_knowledge_llm_assert_run_reservation_consistency"(NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeLlmRun_reservation_consistency"
  AFTER INSERT OR UPDATE ON "KnowledgeLlmRun"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_run_reservation_consistency_trigger"();

CREATE FUNCTION "erp4_knowledge_llm_reservation_run_consistency_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "erp4_knowledge_llm_assert_run_reservation_consistency"(NEW."runId");
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeLlmReservation_run_consistency"
  AFTER INSERT OR UPDATE ON "KnowledgeLlmReservation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_reservation_run_consistency_trigger"();

CREATE FUNCTION "erp4_knowledge_llm_assert_period_accounting"(
  target_period_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  period_active BIGINT;
  period_settled BIGINT;
  period_held BIGINT;
  period_released BIGINT;
  period_count INTEGER;
  expected_active BIGINT;
  expected_settled BIGINT;
  expected_held BIGINT;
  expected_released BIGINT;
  expected_count INTEGER;
BEGIN
  SELECT "activeReservedMicros", "settledActualMicros", "heldMaximumMicros",
    "releasedMicros", "acceptedRequestCount"
  INTO period_active, period_settled, period_held, period_released, period_count
  FROM "KnowledgeLlmBudgetPeriod"
  WHERE id = target_period_id;

  IF period_count IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM("maximumCostMicros") FILTER (WHERE status = 'reserved'), 0),
    COALESCE(SUM("actualCostMicros") FILTER (WHERE status = 'settled_actual'), 0),
    COALESCE(SUM("maximumCostMicros") FILTER (WHERE status = 'held_maximum'), 0),
    COALESCE(SUM(
      CASE
        WHEN status = 'released' THEN "maximumCostMicros"
        WHEN status = 'settled_actual' THEN "maximumCostMicros" - "actualCostMicros"
        ELSE 0
      END
    ), 0),
    COUNT(*)::INTEGER
  INTO expected_active, expected_settled, expected_held, expected_released,
    expected_count
  FROM "KnowledgeLlmReservation"
  WHERE "budgetPeriodId" = target_period_id;

  IF period_active <> expected_active
    OR period_settled <> expected_settled
    OR period_held <> expected_held
    OR period_released <> expected_released
    OR period_count <> expected_count
  THEN
    RAISE EXCEPTION 'KnowledgeLlmBudgetPeriod counters must match reservation ledger'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "erp4_knowledge_llm_reservation_period_consistency_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "erp4_knowledge_llm_assert_period_accounting"(NEW."budgetPeriodId");
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeLlmReservation_period_consistency"
  AFTER INSERT OR UPDATE ON "KnowledgeLlmReservation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_reservation_period_consistency_trigger"();

CREATE FUNCTION "erp4_knowledge_llm_period_accounting_consistency_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "erp4_knowledge_llm_assert_period_accounting"(NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeLlmBudgetPeriod_accounting_consistency"
  AFTER INSERT OR UPDATE ON "KnowledgeLlmBudgetPeriod"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_period_accounting_consistency_trigger"();

CREATE FUNCTION "erp4_knowledge_llm_content_hash"(content TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT encode(
    sha256(
      convert_to('erp4:knowledge:conversation-turn:v1', 'UTF8')
      || decode('00', 'hex')
      || convert_to(content, 'UTF8')
    ),
    'hex'
  );
$$;

CREATE FUNCTION "erp4_knowledge_llm_usage_evidence_insert_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  run_actor TEXT;
  run_execution "KnowledgeLlmExecutionStatus";
  run_settlement "KnowledgeLlmSettlementStatus";
  run_failure "KnowledgeLlmFailureCode";
  run_maximum BIGINT;
  run_input_rate BIGINT;
  run_output_rate BIGINT;
  run_completed_at TIMESTAMP(3);
  expected_cost NUMERIC;
  valid_outcome_count INTEGER;
BEGIN
  SELECT "actorUserId", "executionStatus", "settlementStatus", "failureCode",
    "maximumCostMicros", "inputCostMicrosPerMillion",
    "outputCostMicrosPerMillion", "completedAt"
  INTO run_actor, run_execution, run_settlement, run_failure, run_maximum,
    run_input_rate, run_output_rate, run_completed_at
  FROM "KnowledgeLlmRun"
  WHERE id = NEW."runId"
  FOR UPDATE;

  expected_cost :=
    CEIL(NEW."inputTokens"::NUMERIC * run_input_rate::NUMERIC / 1000000)
    + CEIL(NEW."outputTokens"::NUMERIC * run_output_rate::NUMERIC / 1000000);

  SELECT COUNT(*)::INTEGER
  INTO valid_outcome_count
  FROM "KnowledgeLlmProviderOutcome" outcome
  JOIN "KnowledgeLlmRun" run ON run.id = outcome."runId"
  JOIN "KnowledgeConversationTurn" turn
    ON turn.id = run."assistantTurnId"
   AND turn."conversationId" = run."conversationId"
  WHERE outcome."runId" = NEW."runId"
    AND outcome.status = 'usage_unknown'
    AND outcome."failureCode" = run_failure
    AND outcome."finalizedAt" IS NOT NULL
    AND outcome."normalizedContent" IS NULL
    AND outcome."contentHash" = turn."contentHash"
    AND outcome."contentHash" =
      "erp4_knowledge_llm_content_hash"(turn.content)
    AND turn.role = 'assistant'
    AND turn.origin = 'ai';

  IF run_execution IS NULL
    OR run_execution <> 'result_ready'
    OR run_settlement <> 'held_maximum'
    OR run_failure NOT IN ('usage_missing', 'usage_invalid')
    OR run_completed_at IS NULL
    OR NEW.source <> 'operator_billing'
    OR NEW."createdBy" = run_actor
    OR NEW."createdBy" = ''
    OR NEW."createdBy" <> BTRIM(NEW."createdBy")
    OR CHAR_LENGTH(NEW."createdBy") > 200
    OR NEW."createdBy" ~ '[[:cntrl:]]'
    OR NEW."createdAt" < run_completed_at
    OR NEW."actualCostMicros"::NUMERIC <> expected_cost
    OR NEW."actualCostMicros" > run_maximum
    OR valid_outcome_count <> 1
  THEN
    RAISE EXCEPTION 'KnowledgeLlmUsageEvidence requires a verified held usage-unknown result'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmUsageEvidence_held_result_only"
  BEFORE INSERT ON "KnowledgeLlmUsageEvidence"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_usage_evidence_insert_guard"();

CREATE TRIGGER "KnowledgeLlmUsageEvidence_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeLlmUsageEvidence"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_immutable_row"();

CREATE FUNCTION "erp4_knowledge_llm_outcome_transition_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  run_execution "KnowledgeLlmExecutionStatus";
  run_dispatched_at TIMESTAMP(3);
BEGIN
  SELECT "executionStatus", "dispatchedAt"
  INTO run_execution, run_dispatched_at
  FROM "KnowledgeLlmRun"
  WHERE id = NEW."runId"
  FOR UPDATE;

  IF OLD."runId" <> NEW."runId"
    OR OLD."status" <> NEW."status"
    OR OLD."contentHash" IS DISTINCT FROM NEW."contentHash"
    OR OLD."inputTokens" IS DISTINCT FROM NEW."inputTokens"
    OR OLD."outputTokens" IS DISTINCT FROM NEW."outputTokens"
    OR OLD."failureCode" IS DISTINCT FROM NEW."failureCode"
    OR OLD."capturedAt" <> NEW."capturedAt"
    OR OLD."createdAt" <> NEW."createdAt"
    OR OLD."finalizedAt" IS NOT NULL
    OR OLD."normalizedContent" IS NULL
    OR OLD."contentHash" IS DISTINCT FROM
      "erp4_knowledge_llm_content_hash"(OLD."normalizedContent")
    OR run_execution IS NULL
    OR run_execution NOT IN ('dispatched', 'result_unknown')
    OR run_dispatched_at IS NULL
    OR NEW."finalizedAt" IS NULL
    OR NEW."finalizedAt" < run_dispatched_at
    OR NEW."normalizedContent" IS NOT NULL
  THEN
    RAISE EXCEPTION 'invalid KnowledgeLlmProviderOutcome finalization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "erp4_knowledge_llm_outcome_insert_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  run_execution "KnowledgeLlmExecutionStatus";
  run_dispatched_at TIMESTAMP(3);
BEGIN
  SELECT "executionStatus", "dispatchedAt"
  INTO run_execution, run_dispatched_at
  FROM "KnowledgeLlmRun"
  WHERE id = NEW."runId"
  FOR UPDATE;

  IF run_execution IS NULL
    OR run_execution NOT IN ('dispatched', 'result_unknown')
    OR run_dispatched_at IS NULL
    OR NEW."capturedAt" < run_dispatched_at
    OR (
      NEW.status IN ('valid', 'usage_unknown')
      AND (
      NEW."finalizedAt" IS NOT NULL
      OR NEW."normalizedContent" IS NULL
      OR NEW."contentHash" IS DISTINCT FROM
        "erp4_knowledge_llm_content_hash"(NEW."normalizedContent")
      )
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmProviderOutcome requires provider dispatch and must capture content before finalization with matching hash'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmProviderOutcome_capture_before_finalize"
  BEFORE INSERT ON "KnowledgeLlmProviderOutcome"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_outcome_insert_guard"();

CREATE TRIGGER "KnowledgeLlmProviderOutcome_finalize_only"
  BEFORE UPDATE ON "KnowledgeLlmProviderOutcome"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_outcome_transition_guard"();

CREATE TRIGGER "KnowledgeLlmProviderOutcome_no_delete"
  BEFORE DELETE ON "KnowledgeLlmProviderOutcome"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_immutable_row"();
