-- Expand-only durable prompt staging for saved-outcome reconciliation.
CREATE TABLE "KnowledgeLlmPromptSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "normalizedPrompt" TEXT,
    "promptHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "KnowledgeLlmPromptSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeLlmPromptSnapshot_runId_key"
  ON "KnowledgeLlmPromptSnapshot"("runId");

CREATE INDEX "KnowledgeLlmPromptSnapshot_finalizedAt_capturedAt_id_idx"
  ON "KnowledgeLlmPromptSnapshot"("finalizedAt", "capturedAt", "id");

ALTER TABLE "KnowledgeLlmPromptSnapshot"
  ADD CONSTRAINT "KnowledgeLlmPromptSnapshot_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "KnowledgeLlmRun"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "erp4_knowledge_llm_prompt_hash"(content TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT encode(
    sha256(
      convert_to('erp4:knowledge:llm-user-prompt:v1', 'UTF8')
      || decode('00', 'hex')
      || convert_to(content, 'UTF8')
    ),
    'hex'
  );
$$;

ALTER TABLE "KnowledgeLlmPromptSnapshot"
  ADD CONSTRAINT "KnowledgeLlmPromptSnapshot_shape_check" CHECK (
    "promptHash" ~ '^[0-9a-f]{64}$'
    AND "erp4_knowledge_llm_auth_identifier_valid"("createdBy", 200)
    AND (
      (
        "finalizedAt" IS NULL
        AND "normalizedPrompt" IS NOT NULL
        AND OCTET_LENGTH("normalizedPrompt") BETWEEN 1 AND 16384
      )
      OR (
        "finalizedAt" IS NOT NULL
        AND "normalizedPrompt" IS NULL
      )
    )
  ),
  ADD CONSTRAINT "KnowledgeLlmPromptSnapshot_timestamp_check" CHECK (
    "capturedAt" >= "createdAt"
    AND ("finalizedAt" IS NULL OR "finalizedAt" >= "capturedAt")
  );

CREATE FUNCTION "erp4_knowledge_llm_prompt_snapshot_insert_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  run_actor TEXT;
  run_execution "KnowledgeLlmExecutionStatus";
  run_settlement "KnowledgeLlmSettlementStatus";
  run_created_at TIMESTAMP(3);
BEGIN
  -- Prompt capture takes only the run lock. It never acquires outcome,
  -- reservation, or period locks.
  SELECT "actorUserId", "executionStatus", "settlementStatus", "createdAt"
  INTO run_actor, run_execution, run_settlement, run_created_at
  FROM "KnowledgeLlmRun"
  WHERE id = NEW."runId"
  FOR UPDATE;

  IF run_actor IS NULL
    OR run_execution <> 'reserved'
    OR run_settlement <> 'reserved'
    OR NEW."createdBy" <> run_actor
    OR NOT "erp4_knowledge_llm_auth_identifier_valid"(NEW."createdBy", 200)
    OR NEW."finalizedAt" IS NOT NULL
    OR NEW."normalizedPrompt" IS NULL
    OR NEW."promptHash" IS DISTINCT FROM
      "erp4_knowledge_llm_prompt_hash"(NEW."normalizedPrompt")
    OR NEW."capturedAt" < run_created_at
  THEN
    RAISE EXCEPTION 'KnowledgeLlmPromptSnapshot requires an exact reserved run prompt and canonical actor'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmPromptSnapshot_capture_on_reservation"
  BEFORE INSERT ON "KnowledgeLlmPromptSnapshot"
  FOR EACH ROW
  EXECUTE FUNCTION "erp4_knowledge_llm_prompt_snapshot_insert_guard"();

CREATE FUNCTION "erp4_knowledge_llm_prompt_snapshot_transition_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."runId" <> NEW."runId"
    OR OLD."promptHash" <> NEW."promptHash"
    OR OLD."capturedAt" <> NEW."capturedAt"
    OR OLD."createdAt" <> NEW."createdAt"
    OR OLD."createdBy" <> NEW."createdBy"
    OR OLD."finalizedAt" IS NOT NULL
    OR OLD."normalizedPrompt" IS NULL
    OR OLD."promptHash" IS DISTINCT FROM
      "erp4_knowledge_llm_prompt_hash"(OLD."normalizedPrompt")
    OR NEW."finalizedAt" IS NULL
    OR NEW."normalizedPrompt" IS NOT NULL
  THEN
    RAISE EXCEPTION 'invalid KnowledgeLlmPromptSnapshot finalization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmPromptSnapshot_finalize_only"
  BEFORE UPDATE ON "KnowledgeLlmPromptSnapshot"
  FOR EACH ROW
  EXECUTE FUNCTION "erp4_knowledge_llm_prompt_snapshot_transition_guard"();

CREATE TRIGGER "KnowledgeLlmPromptSnapshot_no_delete"
  BEFORE DELETE ON "KnowledgeLlmPromptSnapshot"
  FOR EACH ROW
  EXECUTE FUNCTION "erp4_knowledge_llm_immutable_row"();

-- Preserve the complete existing run transition contract and add only saved
-- outcome recovery paths.
CREATE OR REPLACE FUNCTION "erp4_knowledge_llm_run_transition_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_actual_cost NUMERIC;
BEGIN
  IF OLD."executionStatus" = 'reserved'
    AND NEW."executionStatus" = 'dispatched'
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "KnowledgeLlmRequest" request
      WHERE request."runId" = NEW.id
        AND request."actorUserId" = NEW."actorUserId"
        AND request."requestPayloadHash" = NEW."requestPayloadHash"
    ) THEN
      RAISE EXCEPTION 'KnowledgeLlmRun dispatch requires matching request ledger'
        USING ERRCODE = '23514';
    END IF;
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
    IF NEW."actualInputTokens" > OLD."estimatedInputTokens"
      OR NEW."actualOutputTokens" > OLD."maxOutputTokens"
    THEN
      RAISE EXCEPTION 'KnowledgeLlmRun actual usage exceeds reserved token ceiling'
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
        AND (
          NEW."completedAt" >= outcome."finalizedAt"
          OR (
            OLD."executionStatus" = 'result_unknown'
            AND OLD."settlementStatus" = 'held_maximum'
            AND OLD."failureCode" = 'finalization_failed'
            AND NEW."updatedAt" >= outcome."finalizedAt"
          )
        )
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
      AND NEW."executionStatus" IN ('result_ready', 'failed')
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
    OR (
      OLD."executionStatus" = 'result_unknown'
      AND OLD."settlementStatus" = 'held_maximum'
      AND OLD."failureCode" = 'finalization_failed'
      AND NEW."executionStatus" = 'result_ready'
      AND NEW."settlementStatus" = 'held_maximum'
      AND NEW."failureCode" IN ('usage_missing', 'usage_invalid')
      AND NEW."conversationId" IS NOT NULL
      AND NEW."assistantTurnId" IS NOT NULL
      AND NEW."actualInputTokens" IS NULL
      AND NEW."actualOutputTokens" IS NULL
      AND NEW."actualCostMicros" IS NULL
      AND NEW."completedAt" >= OLD."completedAt"
      AND EXISTS (
        SELECT 1
        FROM "KnowledgeLlmProviderOutcome" outcome
        JOIN "KnowledgeConversationTurn" turn
          ON turn.id = NEW."assistantTurnId"
         AND turn."conversationId" = NEW."conversationId"
        WHERE outcome."runId" = OLD.id
          AND outcome.status = 'usage_unknown'
          AND outcome."failureCode" = NEW."failureCode"
          AND outcome."finalizedAt" IS NOT NULL
          AND outcome."normalizedContent" IS NULL
          AND outcome."contentHash" = turn."contentHash"
          AND outcome."contentHash" =
            "erp4_knowledge_llm_content_hash"(turn.content)
          AND turn.role = 'assistant'
          AND turn.origin = 'ai'
          AND NEW."updatedAt" >= outcome."finalizedAt"
      )
    )
    OR (
      OLD."executionStatus" = 'result_unknown'
      AND OLD."settlementStatus" = 'held_maximum'
      AND OLD."failureCode" = 'finalization_failed'
      AND NEW."executionStatus" = 'failed'
      AND NEW."settlementStatus" = 'held_maximum'
      AND NEW."failureCode" IN (
        'provider_4xx',
        'provider_5xx',
        'malformed_response',
        'response_oversize',
        'empty_result'
      )
      AND NEW."conversationId" IS NULL
      AND NEW."assistantTurnId" IS NULL
      AND NEW."actualInputTokens" IS NULL
      AND NEW."actualOutputTokens" IS NULL
      AND NEW."actualCostMicros" IS NULL
      AND NEW."completedAt" >= OLD."completedAt"
      AND EXISTS (
        SELECT 1
        FROM "KnowledgeLlmProviderOutcome" outcome
        WHERE outcome."runId" = OLD.id
          AND outcome.status = 'invalid'
          AND outcome."failureCode" = NEW."failureCode"
          AND outcome."normalizedContent" IS NULL
          AND outcome."contentHash" IS NULL
          AND outcome."inputTokens" IS NULL
          AND outcome."outputTokens" IS NULL
          AND outcome."finalizedAt" IS NULL
          AND outcome."capturedAt" <= NEW."completedAt"
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

CREATE FUNCTION "erp4_knowledge_llm_assert_finalized_outcome_consistency"(
  target_run_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  outcome_status "KnowledgeLlmOutcomeStatus";
  outcome_finalized_at TIMESTAMP(3);
BEGIN
  SELECT status, "finalizedAt"
  INTO outcome_status, outcome_finalized_at
  FROM "KnowledgeLlmProviderOutcome"
  WHERE "runId" = target_run_id;

  IF outcome_finalized_at IS NULL THEN
    RETURN;
  END IF;

  IF outcome_status = 'valid' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "KnowledgeLlmProviderOutcome" outcome
      JOIN "KnowledgeLlmRun" run
        ON run.id = outcome."runId"
      JOIN "KnowledgeConversation" conversation
        ON conversation.id = run."conversationId"
       AND conversation."ownerUserId" = run."actorUserId"
      JOIN "KnowledgeConversationTurn" assistant
        ON assistant.id = run."assistantTurnId"
       AND assistant."conversationId" = run."conversationId"
      WHERE outcome."runId" = target_run_id
        AND outcome.status = 'valid'
        AND outcome."finalizedAt" IS NOT NULL
        AND outcome."normalizedContent" IS NULL
        AND run."executionStatus" = 'result_ready'
        AND run."settlementStatus" = 'settled_actual'
        AND run."failureCode" IS NULL
        AND run."actualInputTokens" = outcome."inputTokens"
        AND run."actualOutputTokens" = outcome."outputTokens"
        AND run."actualCostMicros" IS NOT NULL
        AND run."completedAt" >= outcome."finalizedAt"
        AND assistant.role = 'assistant'
        AND assistant.origin = 'ai'
        AND outcome."contentHash" = assistant."contentHash"
        AND outcome."contentHash" =
          "erp4_knowledge_llm_content_hash"(assistant.content)
    ) THEN
      RAISE EXCEPTION 'finalized KnowledgeLlmProviderOutcome requires exact conversation and actual settlement'
        USING ERRCODE = '23514';
    END IF;
  ELSIF outcome_status = 'usage_unknown' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "KnowledgeLlmProviderOutcome" outcome
      JOIN "KnowledgeLlmRun" run
        ON run.id = outcome."runId"
      JOIN "KnowledgeConversation" conversation
        ON conversation.id = run."conversationId"
       AND conversation."ownerUserId" = run."actorUserId"
      JOIN "KnowledgeConversationTurn" assistant
        ON assistant.id = run."assistantTurnId"
       AND assistant."conversationId" = run."conversationId"
      WHERE outcome."runId" = target_run_id
        AND outcome.status = 'usage_unknown'
        AND outcome."finalizedAt" IS NOT NULL
        AND outcome."normalizedContent" IS NULL
        AND run."executionStatus" = 'result_ready'
        AND run."updatedAt" >= outcome."finalizedAt"
        AND assistant.role = 'assistant'
        AND assistant.origin = 'ai'
        AND outcome."contentHash" = assistant."contentHash"
        AND outcome."contentHash" =
          "erp4_knowledge_llm_content_hash"(assistant.content)
        AND (
          (
            run."settlementStatus" = 'held_maximum'
            AND run."failureCode" = outcome."failureCode"
            AND run."failureCode" IN ('usage_missing', 'usage_invalid')
            AND run."actualInputTokens" IS NULL
            AND run."actualOutputTokens" IS NULL
            AND run."actualCostMicros" IS NULL
          )
          OR (
            run."settlementStatus" = 'settled_actual'
            AND run."failureCode" IS NULL
            AND EXISTS (
              SELECT 1
              FROM "KnowledgeLlmUsageEvidence" evidence
              WHERE evidence."runId" = run.id
                AND evidence."inputTokens" = run."actualInputTokens"
                AND evidence."outputTokens" = run."actualOutputTokens"
                AND evidence."actualCostMicros" = run."actualCostMicros"
                AND evidence."createdAt" <= run."completedAt"
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'finalized KnowledgeLlmProviderOutcome requires exact conversation and held or actual settlement'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid KnowledgeLlmProviderOutcome cannot be finalized'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "erp4_knowledge_llm_finalized_outcome_consistency_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "erp4_knowledge_llm_assert_finalized_outcome_consistency"(NEW."runId");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeLlmProviderOutcome_finalized_consistency"
  AFTER INSERT OR UPDATE ON "KnowledgeLlmProviderOutcome"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp4_knowledge_llm_finalized_outcome_consistency_trigger"();

CREATE FUNCTION "erp4_knowledge_llm_assert_finalized_prompt_consistency"(
  target_run_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  prompt_finalized_at TIMESTAMP(3);
BEGIN
  SELECT "finalizedAt"
  INTO prompt_finalized_at
  FROM "KnowledgeLlmPromptSnapshot"
  WHERE "runId" = target_run_id;

  IF prompt_finalized_at IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "KnowledgeLlmPromptSnapshot" prompt
    JOIN "KnowledgeLlmRun" run
      ON run.id = prompt."runId"
    JOIN "KnowledgeConversation" conversation
      ON conversation.id = run."conversationId"
     AND conversation."ownerUserId" = run."actorUserId"
    JOIN "KnowledgeConversationTurn" assistant
      ON assistant.id = run."assistantTurnId"
     AND assistant."conversationId" = run."conversationId"
    JOIN "KnowledgeConversationTurn" user_turn
      ON user_turn."conversationId" = run."conversationId"
     AND user_turn.sequence + 1 = assistant.sequence
    WHERE prompt."runId" = target_run_id
      AND prompt."finalizedAt" IS NOT NULL
      AND prompt."normalizedPrompt" IS NULL
      AND prompt."createdBy" = run."actorUserId"
      AND run."executionStatus" = 'result_ready'
      AND run."settlementStatus" IN ('settled_actual', 'held_maximum')
      AND run."updatedAt" >= prompt."finalizedAt"
      AND assistant.role = 'assistant'
      AND assistant.origin = 'ai'
      AND assistant."createdBy" = run."actorUserId"
      AND assistant."contentHash" =
        "erp4_knowledge_llm_content_hash"(assistant.content)
      AND user_turn.role = 'user'
      AND user_turn.origin = 'user'
      AND user_turn."createdBy" = run."actorUserId"
      AND user_turn."contentHash" =
        "erp4_knowledge_llm_content_hash"(user_turn.content)
      AND prompt."promptHash" =
        "erp4_knowledge_llm_prompt_hash"(user_turn.content)
      AND conversation."createdBy" = run."actorUserId"
      AND conversation."contentHash" = encode(
        sha256(
          convert_to('erp4:knowledge:llm-conversation:v1', 'UTF8')
          || decode('00', 'hex')
          || convert_to(run.id, 'UTF8')
          || decode('00', 'hex')
          || convert_to(prompt."promptHash", 'UTF8')
          || decode('00', 'hex')
          || convert_to(assistant."contentHash", 'UTF8')
        ),
        'hex'
      )
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "KnowledgeLlmPromptSnapshot" prompt
    JOIN "KnowledgeLlmRun" run
      ON run.id = prompt."runId"
    WHERE prompt."runId" = target_run_id
      AND prompt."finalizedAt" IS NOT NULL
      AND prompt."normalizedPrompt" IS NULL
      AND prompt."createdBy" = run."actorUserId"
      AND run."conversationId" IS NULL
      AND run."assistantTurnId" IS NULL
      AND run."updatedAt" >= prompt."finalizedAt"
      AND (
        (
          run."executionStatus" = 'failed'
          AND run."settlementStatus" = 'released'
          AND run."failureCode" IN ('disabled', 'rejected_before_dispatch')
          AND NOT EXISTS (
            SELECT 1
            FROM "KnowledgeLlmProviderOutcome" outcome
            WHERE outcome."runId" = run.id
          )
        )
        OR (
          run."executionStatus" = 'failed'
          AND run."settlementStatus" = 'held_maximum'
          AND run."failureCode" IN (
            'provider_4xx',
            'provider_5xx',
            'malformed_response',
            'response_oversize',
            'empty_result'
          )
          AND EXISTS (
            SELECT 1
            FROM "KnowledgeLlmProviderOutcome" outcome
            WHERE outcome."runId" = run.id
              AND outcome.status = 'invalid'
              AND outcome."failureCode" = run."failureCode"
              AND outcome."normalizedContent" IS NULL
              AND outcome."contentHash" IS NULL
              AND outcome."inputTokens" IS NULL
              AND outcome."outputTokens" IS NULL
              AND outcome."finalizedAt" IS NULL
              AND outcome."capturedAt" <= prompt."finalizedAt"
          )
        )
        OR (
          run."executionStatus" = 'result_unknown'
          AND run."settlementStatus" = 'held_maximum'
          AND run."failureCode" IN (
            'timeout_outcome_unknown',
            'connection_outcome_unknown',
            'finalization_failed'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "KnowledgeLlmProviderOutcome" outcome
            WHERE outcome."runId" = run.id
          )
        )
      )
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'finalized KnowledgeLlmPromptSnapshot requires exact user turn, conversation, and run terminal state'
    USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION "erp4_knowledge_llm_finalized_prompt_consistency_trigger"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "erp4_knowledge_llm_assert_finalized_prompt_consistency"(NEW."runId");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeLlmPromptSnapshot_finalized_consistency"
  AFTER INSERT OR UPDATE ON "KnowledgeLlmPromptSnapshot"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "erp4_knowledge_llm_finalized_prompt_consistency_trigger"();

-- A held reservation was already accounted at the original result-unknown
-- terminal time. Saved-outcome recovery may advance the run completion time
-- without mutating that terminal reservation or any period counter.
CREATE OR REPLACE FUNCTION "erp4_knowledge_llm_assert_run_reservation_consistency"(
  target_run_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  run_scope "KnowledgeLlmRunScope";
  run_execution "KnowledgeLlmExecutionStatus";
  run_settlement "KnowledgeLlmSettlementStatus";
  run_failure "KnowledgeLlmFailureCode";
  run_maximum BIGINT;
  run_actual BIGINT;
  run_completed_at TIMESTAMP(3);
  held_saved_outcome_recovery BOOLEAN;
  expected_count INTEGER;
  reservation_count INTEGER;
  mismatched_count INTEGER;
BEGIN
  SELECT scope, "executionStatus", "settlementStatus", "failureCode",
    "maximumCostMicros", "actualCostMicros", "completedAt"
  INTO run_scope, run_execution, run_settlement, run_failure, run_maximum,
    run_actual, run_completed_at
  FROM "KnowledgeLlmRun"
  WHERE id = target_run_id;

  IF run_scope IS NULL THEN
    RETURN;
  END IF;

  held_saved_outcome_recovery :=
    run_settlement = 'held_maximum'
    AND (
      (
        run_execution = 'result_ready'
        AND run_failure IN ('usage_missing', 'usage_invalid')
        AND EXISTS (
          SELECT 1
          FROM "KnowledgeLlmProviderOutcome" outcome
          WHERE outcome."runId" = target_run_id
            AND outcome.status = 'usage_unknown'
            AND outcome."failureCode" = run_failure
            AND outcome."finalizedAt" IS NOT NULL
            AND outcome."normalizedContent" IS NULL
        )
      )
      OR (
        run_execution = 'failed'
        AND run_failure IN (
          'provider_4xx',
          'provider_5xx',
          'malformed_response',
          'response_oversize',
          'empty_result'
        )
        AND EXISTS (
          SELECT 1
          FROM "KnowledgeLlmProviderOutcome" outcome
          WHERE outcome."runId" = target_run_id
            AND outcome.status = 'invalid'
            AND outcome."failureCode" = run_failure
            AND outcome."finalizedAt" IS NULL
            AND outcome."normalizedContent" IS NULL
        )
      )
    );

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
            OR reservation."settledAt" IS NULL
            OR (
              held_saved_outcome_recovery
              AND reservation."settledAt" > run_completed_at
            )
            OR (
              NOT held_saved_outcome_recovery
              AND reservation."settledAt" IS DISTINCT FROM run_completed_at
            )
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
