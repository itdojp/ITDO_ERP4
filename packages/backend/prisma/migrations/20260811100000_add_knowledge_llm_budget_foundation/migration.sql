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
    "selectedContextFingerprint" TEXT NOT NULL,
    "estimatedInputTokens" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "maximumCostMicros" BIGINT NOT NULL,
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


-- Application-independent integrity for budget accounting and immutable
-- provenance. These tables are expand-only and contain no existing-row
-- rewrites.

ALTER TABLE "KnowledgeLlmBudgetPolicy"
  ADD CONSTRAINT "KnowledgeLlmBudgetPolicy_identity_check" CHECK (
    LENGTH(BTRIM("subjectId")) BETWEEN 1 AND 200
    AND "currency" ~ '^[A-Z]{3}$'
    AND LENGTH(BTRIM("timezone")) BETWEEN 1 AND 100
    AND LENGTH(BTRIM("createdBy")) BETWEEN 1 AND 200
    AND LENGTH(BTRIM("updatedBy")) BETWEEN 1 AND 200
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
    AND LENGTH(BTRIM("timezone")) BETWEEN 1 AND 100
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
BEGIN
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmBudgetPeriod_boundary_guard"
  BEFORE UPDATE ON "KnowledgeLlmBudgetPeriod"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_period_boundary_guard"();

ALTER TABLE "KnowledgeLlmRun"
  ADD CONSTRAINT "KnowledgeLlmRun_identity_check" CHECK (
    LENGTH(BTRIM("actorUserId")) BETWEEN 1 AND 200
    AND LENGTH(BTRIM("model")) BETWEEN 1 AND 200
    AND "currency" ~ '^[A-Z]{3}$'
    AND LENGTH(BTRIM("createdBy")) BETWEEN 1 AND 200
    AND LENGTH(BTRIM("updatedBy")) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT "KnowledgeLlmRun_scope_check" CHECK (
    ("scope" = 'personal' AND "organizationId" IS NULL)
    OR (
      "scope" = 'organization'
      AND "organizationId" IS NOT NULL
      AND LENGTH(BTRIM("organizationId")) BETWEEN 1 AND 200
    )
  ),
  ADD CONSTRAINT "KnowledgeLlmRun_request_check" CHECK (
    "catalogVersion" >= 1
    AND "promptTemplateVersion" >= 1
    AND "requestPayloadHash" ~ '^[0-9a-f]{64}$'
    AND "selectedContextFingerprint" ~ '^[0-9a-f]{64}$'
    AND "estimatedInputTokens" BETWEEN 1 AND 2147483647
    AND "maxOutputTokens" BETWEEN 1 AND 4096
    AND "maximumCostMicros" >= 0
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
      AND "assistantTurnId" IS NULL
      AND "actualInputTokens" IS NULL
      AND "actualOutputTokens" IS NULL
      AND "actualCostMicros" IS NULL
    )
    OR (
      "executionStatus" = 'dispatched'
      AND "settlementStatus" IN ('reserved', 'held_maximum')
      AND "failureCode" IS NULL
      AND "dispatchedAt" IS NOT NULL
      AND "completedAt" IS NULL
      AND "assistantTurnId" IS NULL
      AND "actualCostMicros" IS NULL
    )
    OR (
      "executionStatus" = 'result_ready'
      AND "settlementStatus" IN ('settled_actual', 'held_maximum')
      AND "dispatchedAt" IS NOT NULL
      AND "completedAt" IS NOT NULL
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
          AND "failureCode" IN ('usage_missing', 'usage_invalid', 'finalization_failed')
          AND "actualCostMicros" IS NULL
        )
      )
    )
    OR (
      "executionStatus" = 'failed'
      AND "settlementStatus" IN ('released', 'held_maximum')
      AND "failureCode" IS NOT NULL
      AND "completedAt" IS NOT NULL
      AND "assistantTurnId" IS NULL
      AND "actualCostMicros" IS NULL
      AND (
        (
          "settlementStatus" = 'released'
          AND "failureCode" IN ('disabled', 'rejected_before_dispatch')
          AND "dispatchedAt" IS NULL
        )
        OR (
          "settlementStatus" = 'released'
          AND "failureCode" = 'provider_4xx'
          AND "dispatchedAt" IS NOT NULL
        )
        OR (
          "settlementStatus" = 'held_maximum'
          AND "failureCode" IN (
            'provider_5xx',
            'malformed_response',
            'response_oversize',
            'empty_result',
            'usage_missing',
            'usage_invalid',
            'timeout_outcome_unknown',
            'connection_outcome_unknown',
            'finalization_failed'
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
      AND "assistantTurnId" IS NULL
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
    LENGTH(BTRIM("actorUserId")) BETWEEN 1 AND 200
    AND LENGTH(BTRIM("createdBy")) BETWEEN 1 AND 200
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
    AND LENGTH(BTRIM("createdBy")) BETWEEN 1 AND 200
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

CREATE TRIGGER "KnowledgeLlmContextSource_immutable"
  BEFORE UPDATE OR DELETE ON "KnowledgeLlmContextSource"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_immutable_row"();

CREATE FUNCTION "erp4_knowledge_llm_run_transition_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."executionStatus" = 'result_ready'
    AND NEW."settlementStatus" = 'settled_actual'
    AND NOT EXISTS (
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
    )
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun settlement requires a valid provider outcome'
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
    OR OLD."selectedContextFingerprint" <> NEW."selectedContextFingerprint"
    OR OLD."estimatedInputTokens" <> NEW."estimatedInputTokens"
    OR OLD."maxOutputTokens" <> NEW."maxOutputTokens"
    OR OLD."maximumCostMicros" <> NEW."maximumCostMicros"
    OR OLD."currency" <> NEW."currency"
    OR OLD."createdAt" <> NEW."createdAt"
    OR OLD."createdBy" <> NEW."createdBy"
  THEN
    RAISE EXCEPTION 'KnowledgeLlmRun request boundary is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."completedAt" IS NOT NULL AND NOT (
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
      WHERE outcome."runId" = OLD.id
        AND outcome.status = 'valid'
        AND outcome."finalizedAt" IS NOT NULL
        AND outcome."normalizedContent" IS NULL
        AND outcome."inputTokens" = NEW."actualInputTokens"
        AND outcome."outputTokens" = NEW."actualOutputTokens"
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
BEGIN
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmReservation_transition_guard"
  BEFORE UPDATE ON "KnowledgeLlmReservation"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_reservation_transition_guard"();

CREATE FUNCTION "erp4_knowledge_llm_outcome_transition_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."runId" <> NEW."runId"
    OR OLD."status" <> NEW."status"
    OR OLD."contentHash" IS DISTINCT FROM NEW."contentHash"
    OR OLD."inputTokens" IS DISTINCT FROM NEW."inputTokens"
    OR OLD."outputTokens" IS DISTINCT FROM NEW."outputTokens"
    OR OLD."failureCode" IS DISTINCT FROM NEW."failureCode"
    OR OLD."capturedAt" <> NEW."capturedAt"
    OR OLD."createdAt" <> NEW."createdAt"
    OR OLD."finalizedAt" IS NOT NULL
    OR NEW."finalizedAt" IS NULL
    OR NEW."normalizedContent" IS NOT NULL
  THEN
    RAISE EXCEPTION 'invalid KnowledgeLlmProviderOutcome finalization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmProviderOutcome_finalize_only"
  BEFORE UPDATE ON "KnowledgeLlmProviderOutcome"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_outcome_transition_guard"();

CREATE TRIGGER "KnowledgeLlmProviderOutcome_no_delete"
  BEFORE DELETE ON "KnowledgeLlmProviderOutcome"
  FOR EACH ROW EXECUTE FUNCTION "erp4_knowledge_llm_immutable_row"();
