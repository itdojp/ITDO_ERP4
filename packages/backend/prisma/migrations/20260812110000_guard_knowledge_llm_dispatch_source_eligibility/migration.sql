-- Keep direct database dispatches aligned with the application source allowlist.
-- This is additive so databases that already applied the budget foundation gain
-- the guard without rewriting or removing historical rows.
CREATE FUNCTION "erp4_knowledge_llm_dispatch_source_eligibility_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."executionStatus" = 'reserved'
    AND NEW."executionStatus" = 'dispatched'
  THEN
    IF EXISTS (
      SELECT 1
      FROM "KnowledgeLlmContextSource" source
      JOIN "KnowledgeConversationTurn" turn
        ON turn.id = source."sourceConversationTurnId"
      WHERE source."runId" = NEW.id
        AND source."sourceType" = 'conversation_turn'
        AND (
          turn.role NOT IN ('user', 'assistant')
          OR EXISTS (
            SELECT 1
            FROM "KnowledgeLlmRun" prior_run
            WHERE prior_run."conversationId" = turn."conversationId"
          )
        )
    ) THEN
      RAISE EXCEPTION 'KnowledgeLlmRun dispatch conversation source is not eligible'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "KnowledgeLlmContextSource" source
      JOIN "KnowledgeSynthesisSource" provenance
        ON provenance."synthesisVersionId" = source."sourceSynthesisVersionId"
      LEFT JOIN "KnowledgeConversationTurn" provenance_turn
        ON provenance_turn.id = provenance."sourceConversationTurnId"
      WHERE source."runId" = NEW.id
        AND source."sourceType" = 'synthesis_version'
        AND (
          EXISTS (
            SELECT 1
            FROM "KnowledgeLlmRun" prior_run
            WHERE prior_run."conversationId" = provenance."sourceConversationId"
          )
          OR EXISTS (
            SELECT 1
            FROM "KnowledgeLlmRun" prior_run
            WHERE prior_run."conversationId" = provenance_turn."conversationId"
          )
        )
    ) THEN
      RAISE EXCEPTION 'KnowledgeLlmRun dispatch synthesis source is not eligible'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeLlmRun_dispatch_source_eligibility_guard"
  BEFORE UPDATE OF "executionStatus" ON "KnowledgeLlmRun"
  FOR EACH ROW
  EXECUTE FUNCTION "erp4_knowledge_llm_dispatch_source_eligibility_guard"();
