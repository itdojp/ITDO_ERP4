-- Issue #2013 PR B: owner-scoped idempotency ledger for bounded conversation imports.
-- Expand-only: application rollback keeps this table and imported data intact.

CREATE TABLE "KnowledgeConversationImportRequest" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "requestKeyHash" TEXT NOT NULL,
  "canonicalPayloadHash" TEXT NOT NULL,
  "sourceType" "KnowledgeConversationSourceType" NOT NULL,
  "conversationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeConversationImportRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeConversationImportRequest_requestKeyHash_check"
    CHECK ("requestKeyHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "KnowledgeConversationImportRequest_canonicalPayloadHash_check"
    CHECK ("canonicalPayloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "KnowledgeConversationImportRequest_owner_check"
    CHECK (LENGTH(BTRIM("ownerUserId")) > 0),
  CONSTRAINT "KnowledgeConversationImportRequest_actor_check"
    CHECK ("createdBy" = "ownerUserId")
);

ALTER TABLE "KnowledgeConversation"
  ADD CONSTRAINT "KnowledgeConversation_import_provider_check"
  CHECK (
    "provider" IS NULL OR
    "provider" IN ('openai', 'anthropic', 'google', 'microsoft', 'other')
  ) NOT VALID;

ALTER TABLE "KnowledgeConversation"
  ADD CONSTRAINT "KnowledgeConversation_import_model_check"
  CHECK (
    "model" IS NULL OR
    "model" IN ('gpt', 'claude', 'gemini', 'copilot', 'other')
  ) NOT VALID;

ALTER TABLE "KnowledgeConversationTurn"
  ADD CONSTRAINT "KnowledgeConversationTurn_import_name_check"
  CHECK (
    "name" IS NULL OR
    (
      "role" = 'tool' AND
      "name" IN ('search', 'browser', 'code', 'file', 'other')
    )
  ) NOT VALID;

CREATE UNIQUE INDEX "KnowledgeConversationImportRequest_ownerUserId_requestKeyHa_key"
  ON "KnowledgeConversationImportRequest"("ownerUserId", "requestKeyHash");
CREATE INDEX "KnowledgeConversationImportRequest_ownerUserId_createdAt_id_idx"
  ON "KnowledgeConversationImportRequest"("ownerUserId", "createdAt", "id");
CREATE INDEX "KnowledgeConversationImportRequest_conversationId_ownerUser_idx"
  ON "KnowledgeConversationImportRequest"("conversationId", "ownerUserId");

ALTER TABLE "KnowledgeConversationImportRequest"
  ADD CONSTRAINT "KnowledgeConversationImportRequest_conversationId_ownerUse_fkey"
  FOREIGN KEY ("conversationId", "ownerUserId")
  REFERENCES "KnowledgeConversation"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE TRIGGER "KnowledgeConversationImportRequest_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "KnowledgeConversationImportRequest"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_knowledge_provenance_history_mutation"();
