CREATE TYPE "KnowledgeAnnotationKind" AS ENUM (
  'note', 'question', 'hypothesis', 'quote', 'todo'
);

CREATE TYPE "KnowledgeProvenanceOrigin" AS ENUM (
  'user', 'external', 'ai', 'system', 'tool'
);

CREATE TYPE "KnowledgeConversationSourceType" AS ENUM (
  'manual', 'json', 'markdown'
);

CREATE TYPE "KnowledgeConversationRole" AS ENUM (
  'user', 'assistant', 'system', 'tool'
);

CREATE TYPE "KnowledgeConversationItemRelationType" AS ENUM (
  'primary', 'supporting', 'contradicting', 'context'
);

CREATE TYPE "KnowledgeSynthesisSourceRelationType" AS ENUM (
  'primary', 'supporting', 'contradicting', 'context'
);

CREATE TABLE "KnowledgeAnnotation" (
  "id" TEXT NOT NULL,
  "knowledgeItemId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "scope" "KnowledgeItemScope" NOT NULL,
  "organizationId" TEXT,
  "kind" "KnowledgeAnnotationKind" NOT NULL,
  "origin" "KnowledgeProvenanceOrigin" NOT NULL,
  "currentRevision" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeAnnotation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeAnnotation_revision_check" CHECK ("currentRevision" >= 1),
  CONSTRAINT "KnowledgeAnnotation_owner_check" CHECK (
    LENGTH(BTRIM("ownerUserId")) > 0
    AND "authorUserId" = "ownerUserId"
  ),
  CONSTRAINT "KnowledgeAnnotation_scope_organization_check" CHECK (
    ("scope" = 'personal' AND "organizationId" IS NULL)
    OR
    ("scope" = 'organization' AND "organizationId" IS NOT NULL
      AND LENGTH(BTRIM("organizationId")) > 0)
  ),
  CONSTRAINT "KnowledgeAnnotation_deletion_state_check" CHECK (
    ("deletedAt" IS NULL AND "deletedBy" IS NULL)
    OR ("deletedAt" IS NOT NULL AND "deletedBy" IS NOT NULL)
  )
);

CREATE TABLE "KnowledgeAnnotationRevision" (
  "id" TEXT NOT NULL,
  "annotationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" "KnowledgeAnnotationKind" NOT NULL,
  "origin" "KnowledgeProvenanceOrigin" NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeAnnotationRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeAnnotationRevision_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "KnowledgeAnnotationRevision_content_check" CHECK (
    OCTET_LENGTH("content") BETWEEN 1 AND 65536
  )
);

CREATE TABLE "KnowledgeConversation" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sourceType" "KnowledgeConversationSourceType" NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importedAt" TIMESTAMP(3),
  "contentHash" TEXT NOT NULL,
  "idempotencyHash" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeConversation_owner_check" CHECK (
    LENGTH(BTRIM("ownerUserId")) > 0
  ),
  CONSTRAINT "KnowledgeConversation_version_check" CHECK ("version" >= 1),
  CONSTRAINT "KnowledgeConversation_content_hash_check" CHECK (
    "contentHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "KnowledgeConversation_idempotency_hash_check" CHECK (
    "idempotencyHash" IS NULL OR "idempotencyHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "KnowledgeConversation_deletion_state_check" CHECK (
    ("deletedAt" IS NULL AND "deletedBy" IS NULL)
    OR ("deletedAt" IS NOT NULL AND "deletedBy" IS NOT NULL)
  )
);

CREATE TABLE "KnowledgeConversationItem" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "knowledgeItemId" TEXT NOT NULL,
  "relationType" "KnowledgeConversationItemRelationType" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeConversationItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeConversationItem_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE TABLE "KnowledgeConversationTurn" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "role" "KnowledgeConversationRole" NOT NULL,
  "origin" "KnowledgeProvenanceOrigin" NOT NULL,
  "content" TEXT NOT NULL,
  "name" TEXT,
  "occurredAt" TIMESTAMP(3),
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeConversationTurn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeConversationTurn_sequence_check" CHECK ("sequence" >= 1),
  CONSTRAINT "KnowledgeConversationTurn_content_check" CHECK (
    OCTET_LENGTH("content") BETWEEN 1 AND 65536
  ),
  CONSTRAINT "KnowledgeConversationTurn_content_hash_check" CHECK (
    "contentHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "KnowledgeConversationTurn_role_origin_check" CHECK (
    ("role" = 'user' AND "origin" IN ('user', 'external'))
    OR ("role" = 'assistant' AND "origin" IN ('ai', 'external'))
    OR ("role" = 'system' AND "origin" = 'system')
    OR ("role" = 'tool' AND "origin" = 'tool')
  )
);

CREATE TABLE "KnowledgeSynthesis" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "scope" "KnowledgeItemScope" NOT NULL,
  "organizationId" TEXT,
  "title" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeSynthesis_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSynthesis_owner_check" CHECK (
    LENGTH(BTRIM("ownerUserId")) > 0
  ),
  CONSTRAINT "KnowledgeSynthesis_version_check" CHECK ("currentVersion" >= 1),
  CONSTRAINT "KnowledgeSynthesis_scope_organization_check" CHECK (
    ("scope" = 'personal' AND "organizationId" IS NULL)
    OR
    ("scope" = 'organization' AND "organizationId" IS NOT NULL
      AND LENGTH(BTRIM("organizationId")) > 0)
  ),
  CONSTRAINT "KnowledgeSynthesis_deletion_state_check" CHECK (
    ("deletedAt" IS NULL AND "deletedBy" IS NULL)
    OR ("deletedAt" IS NOT NULL AND "deletedBy" IS NOT NULL)
  )
);

CREATE TABLE "KnowledgeSynthesisVersion" (
  "id" TEXT NOT NULL,
  "synthesisId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "unresolvedQuestions" JSONB NOT NULL,
  "confidenceBasisPoints" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeSynthesisVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSynthesisVersion_version_check" CHECK ("version" >= 1),
  CONSTRAINT "KnowledgeSynthesisVersion_content_check" CHECK (
    OCTET_LENGTH("content") BETWEEN 1 AND 262144
  ),
  CONSTRAINT "KnowledgeSynthesisVersion_questions_check" CHECK (
    JSONB_TYPEOF("unresolvedQuestions") = 'array'
    AND JSONB_ARRAY_LENGTH("unresolvedQuestions") <= 50
  ),
  CONSTRAINT "KnowledgeSynthesisVersion_confidence_check" CHECK (
    "confidenceBasisPoints" IS NULL
    OR "confidenceBasisPoints" BETWEEN 0 AND 10000
  )
);

CREATE TABLE "KnowledgeSynthesisSource" (
  "id" TEXT NOT NULL,
  "synthesisVersionId" TEXT NOT NULL,
  "relationType" "KnowledgeSynthesisSourceRelationType" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "sourceKnowledgeItemId" TEXT,
  "sourceSnapshotId" TEXT,
  "sourceAnnotationId" TEXT,
  "sourceAnnotationRevisionId" TEXT,
  "sourceConversationId" TEXT,
  "sourceConversationTurnId" TEXT,
  "sourceSynthesisVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeSynthesisSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSynthesisSource_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "KnowledgeSynthesisSource_exactly_one_check" CHECK (
    NUM_NONNULLS(
      "sourceKnowledgeItemId",
      "sourceSnapshotId",
      "sourceAnnotationId",
      "sourceAnnotationRevisionId",
      "sourceConversationId",
      "sourceConversationTurnId",
      "sourceSynthesisVersionId"
    ) = 1
  ),
  CONSTRAINT "KnowledgeSynthesisSource_no_self_reference_check" CHECK (
    "sourceSynthesisVersionId" IS NULL
    OR "sourceSynthesisVersionId" <> "synthesisVersionId"
  )
);

CREATE FUNCTION "enforce_knowledge_conversation_item_same_owner"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "KnowledgeConversation" AS conversation
    INNER JOIN "KnowledgeItem" AS item
      ON item."id" = NEW."knowledgeItemId"
    WHERE conversation."id" = NEW."conversationId"
      AND conversation."ownerUserId" <> item."ownerUserId"
  ) THEN
    RAISE EXCEPTION 'knowledge conversation item owner must match conversation owner'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'KnowledgeConversationItem_same_owner_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeConversationItem_same_owner_trigger"
AFTER INSERT OR UPDATE ON "KnowledgeConversationItem"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "enforce_knowledge_conversation_item_same_owner"();

CREATE FUNCTION "enforce_knowledge_synthesis_source_no_same_aggregate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."sourceSynthesisVersionId" IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "KnowledgeSynthesisVersion" AS target_version
    INNER JOIN "KnowledgeSynthesisVersion" AS source_version
      ON source_version."id" = NEW."sourceSynthesisVersionId"
    WHERE target_version."id" = NEW."synthesisVersionId"
      AND target_version."synthesisId" = source_version."synthesisId"
  ) THEN
    RAISE EXCEPTION 'knowledge synthesis cannot source its own version history'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'KnowledgeSynthesisSource_no_same_aggregate_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeSynthesisSource_no_same_aggregate_trigger"
AFTER INSERT OR UPDATE ON "KnowledgeSynthesisSource"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "enforce_knowledge_synthesis_source_no_same_aggregate"();

CREATE FUNCTION "reject_knowledge_provenance_history_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable knowledge provenance history cannot be updated or deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "KnowledgeAnnotationRevision_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeAnnotationRevision"
FOR EACH ROW
EXECUTE FUNCTION "reject_knowledge_provenance_history_mutation"();

CREATE TRIGGER "KnowledgeConversationTurn_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeConversationTurn"
FOR EACH ROW
EXECUTE FUNCTION "reject_knowledge_provenance_history_mutation"();

CREATE TRIGGER "KnowledgeSynthesisVersion_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeSynthesisVersion"
FOR EACH ROW
EXECUTE FUNCTION "reject_knowledge_provenance_history_mutation"();

CREATE TRIGGER "KnowledgeSynthesisSource_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeSynthesisSource"
FOR EACH ROW
EXECUTE FUNCTION "reject_knowledge_provenance_history_mutation"();

CREATE UNIQUE INDEX "KnowledgeAnnotationRevision_annotationId_revision_key"
  ON "KnowledgeAnnotationRevision"("annotationId", "revision");
CREATE INDEX "KnowledgeAnnotation_knowledgeItemId_deletedAt_updatedAt_id_idx"
  ON "KnowledgeAnnotation"("knowledgeItemId", "deletedAt", "updatedAt", "id");
CREATE INDEX "KnowledgeAnnotation_ownerUserId_deletedAt_updatedAt_id_idx"
  ON "KnowledgeAnnotation"("ownerUserId", "deletedAt", "updatedAt", "id");
CREATE INDEX "KnowledgeAnnotationRevision_annotationId_createdAt_id_idx"
  ON "KnowledgeAnnotationRevision"("annotationId", "createdAt", "id");

CREATE UNIQUE INDEX "KnowledgeConversation_ownerUserId_idempotencyHash_key"
  ON "KnowledgeConversation"("ownerUserId", "idempotencyHash");
CREATE INDEX "KnowledgeConversation_ownerUserId_deletedAt_updatedAt_id_idx"
  ON "KnowledgeConversation"("ownerUserId", "deletedAt", "updatedAt", "id");
CREATE UNIQUE INDEX "KnowledgeConversationItem_conversationId_knowledgeItemId_key"
  ON "KnowledgeConversationItem"("conversationId", "knowledgeItemId");
CREATE UNIQUE INDEX "KnowledgeConversationItem_conversationId_ordinal_key"
  ON "KnowledgeConversationItem"("conversationId", "ordinal");
CREATE UNIQUE INDEX "KnowledgeConversationItem_one_primary_key"
  ON "KnowledgeConversationItem"("conversationId")
  WHERE "relationType" = 'primary';
CREATE INDEX "KnowledgeConversationItem_knowledgeItemId_conversationId_idx"
  ON "KnowledgeConversationItem"("knowledgeItemId", "conversationId");
CREATE UNIQUE INDEX "KnowledgeConversationTurn_conversationId_sequence_key"
  ON "KnowledgeConversationTurn"("conversationId", "sequence");
CREATE INDEX "KnowledgeConversationTurn_conversationId_createdAt_id_idx"
  ON "KnowledgeConversationTurn"("conversationId", "createdAt", "id");

CREATE INDEX "KnowledgeSynthesis_ownerUserId_deletedAt_updatedAt_id_idx"
  ON "KnowledgeSynthesis"("ownerUserId", "deletedAt", "updatedAt", "id");
CREATE INDEX "KnowledgeSynthesis_organizationId_scope_deletedAt_updatedAt_idx"
  ON "KnowledgeSynthesis"("organizationId", "scope", "deletedAt", "updatedAt", "id");
CREATE UNIQUE INDEX "KnowledgeSynthesisVersion_synthesisId_version_key"
  ON "KnowledgeSynthesisVersion"("synthesisId", "version");
CREATE INDEX "KnowledgeSynthesisVersion_synthesisId_createdAt_id_idx"
  ON "KnowledgeSynthesisVersion"("synthesisId", "createdAt", "id");
CREATE UNIQUE INDEX "KnowledgeSynthesisSource_synthesisVersionId_ordinal_key"
  ON "KnowledgeSynthesisSource"("synthesisVersionId", "ordinal");
CREATE INDEX "KnowledgeSynthesisSource_sourceKnowledgeItemId_idx"
  ON "KnowledgeSynthesisSource"("sourceKnowledgeItemId");
CREATE INDEX "KnowledgeSynthesisSource_sourceSnapshotId_idx"
  ON "KnowledgeSynthesisSource"("sourceSnapshotId");
CREATE INDEX "KnowledgeSynthesisSource_sourceAnnotationId_idx"
  ON "KnowledgeSynthesisSource"("sourceAnnotationId");
CREATE INDEX "KnowledgeSynthesisSource_sourceAnnotationRevisionId_idx"
  ON "KnowledgeSynthesisSource"("sourceAnnotationRevisionId");
CREATE INDEX "KnowledgeSynthesisSource_sourceConversationId_idx"
  ON "KnowledgeSynthesisSource"("sourceConversationId");
CREATE INDEX "KnowledgeSynthesisSource_sourceConversationTurnId_idx"
  ON "KnowledgeSynthesisSource"("sourceConversationTurnId");
CREATE INDEX "KnowledgeSynthesisSource_sourceSynthesisVersionId_idx"
  ON "KnowledgeSynthesisSource"("sourceSynthesisVersionId");

CREATE UNIQUE INDEX "KnowledgeSynthesisSource_item_once_key"
  ON "KnowledgeSynthesisSource"("synthesisVersionId", "sourceKnowledgeItemId")
  WHERE "sourceKnowledgeItemId" IS NOT NULL;
CREATE UNIQUE INDEX "KnowledgeSynthesisSource_snapshot_once_key"
  ON "KnowledgeSynthesisSource"("synthesisVersionId", "sourceSnapshotId")
  WHERE "sourceSnapshotId" IS NOT NULL;
CREATE UNIQUE INDEX "KnowledgeSynthesisSource_annotation_once_key"
  ON "KnowledgeSynthesisSource"("synthesisVersionId", "sourceAnnotationId")
  WHERE "sourceAnnotationId" IS NOT NULL;
CREATE UNIQUE INDEX "KnowledgeSynthesisSource_annotation_revision_once_key"
  ON "KnowledgeSynthesisSource"("synthesisVersionId", "sourceAnnotationRevisionId")
  WHERE "sourceAnnotationRevisionId" IS NOT NULL;
CREATE UNIQUE INDEX "KnowledgeSynthesisSource_conversation_once_key"
  ON "KnowledgeSynthesisSource"("synthesisVersionId", "sourceConversationId")
  WHERE "sourceConversationId" IS NOT NULL;
CREATE UNIQUE INDEX "KnowledgeSynthesisSource_turn_once_key"
  ON "KnowledgeSynthesisSource"("synthesisVersionId", "sourceConversationTurnId")
  WHERE "sourceConversationTurnId" IS NOT NULL;
CREATE UNIQUE INDEX "KnowledgeSynthesisSource_synthesis_version_once_key"
  ON "KnowledgeSynthesisSource"("synthesisVersionId", "sourceSynthesisVersionId")
  WHERE "sourceSynthesisVersionId" IS NOT NULL;

ALTER TABLE "KnowledgeAnnotation"
  ADD CONSTRAINT "KnowledgeAnnotation_knowledgeItemId_fkey"
  FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeAnnotationRevision"
  ADD CONSTRAINT "KnowledgeAnnotationRevision_annotationId_fkey"
  FOREIGN KEY ("annotationId") REFERENCES "KnowledgeAnnotation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeConversationItem"
  ADD CONSTRAINT "KnowledgeConversationItem_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "KnowledgeConversation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeConversationItem"
  ADD CONSTRAINT "KnowledgeConversationItem_knowledgeItemId_fkey"
  FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeConversationTurn"
  ADD CONSTRAINT "KnowledgeConversationTurn_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "KnowledgeConversation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisVersion"
  ADD CONSTRAINT "KnowledgeSynthesisVersion_synthesisId_fkey"
  FOREIGN KEY ("synthesisId") REFERENCES "KnowledgeSynthesis"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_synthesisVersionId_fkey"
  FOREIGN KEY ("synthesisVersionId") REFERENCES "KnowledgeSynthesisVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_sourceKnowledgeItemId_fkey"
  FOREIGN KEY ("sourceKnowledgeItemId") REFERENCES "KnowledgeItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_sourceSnapshotId_fkey"
  FOREIGN KEY ("sourceSnapshotId") REFERENCES "KnowledgeSnapshot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_sourceAnnotationId_fkey"
  FOREIGN KEY ("sourceAnnotationId") REFERENCES "KnowledgeAnnotation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_sourceAnnotationRevisionId_fkey"
  FOREIGN KEY ("sourceAnnotationRevisionId") REFERENCES "KnowledgeAnnotationRevision"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_sourceConversationId_fkey"
  FOREIGN KEY ("sourceConversationId") REFERENCES "KnowledgeConversation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_sourceConversationTurnId_fkey"
  FOREIGN KEY ("sourceConversationTurnId") REFERENCES "KnowledgeConversationTurn"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_sourceSynthesisVersionId_fkey"
  FOREIGN KEY ("sourceSynthesisVersionId") REFERENCES "KnowledgeSynthesisVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scope the shared AuditLog target-table contract to the new Knowledge
-- provenance actions. NOT VALID preserves additive compatibility for existing
-- rows while PostgreSQL enforces the constraint for every new write.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_knowledge_provenance_target_check" CHECK (
  "action" NOT IN (
    'knowledge_annotation_created',
    'knowledge_annotation_revised',
    'knowledge_annotation_deleted',
    'knowledge_conversation_created',
    'knowledge_conversation_imported',
    'knowledge_conversation_item_linked',
    'knowledge_conversation_item_unlinked',
    'knowledge_conversation_turn_appended',
    'knowledge_synthesis_created',
    'knowledge_synthesis_version_appended',
    'knowledge_synthesis_source_linked',
    'knowledge_import_previewed',
    'knowledge_import_committed',
    'knowledge_import_duplicate_detected',
    'knowledge_import_rejected'
  )
  OR (
    "targetTable" IS NOT NULL
    AND "targetId" IS NOT NULL
    AND (
      (
        "action" IN (
          'knowledge_annotation_created',
          'knowledge_annotation_revised',
          'knowledge_annotation_deleted'
        )
        AND "targetTable" = 'knowledge_annotations'
      )
      OR (
        "action" IN (
          'knowledge_conversation_created',
          'knowledge_conversation_imported',
          'knowledge_conversation_item_linked',
          'knowledge_conversation_item_unlinked',
          'knowledge_conversation_turn_appended'
        )
        AND "targetTable" = 'knowledge_conversations'
      )
      OR (
        "action" IN (
          'knowledge_synthesis_created',
          'knowledge_synthesis_version_appended',
          'knowledge_synthesis_source_linked'
        )
        AND "targetTable" = 'knowledge_syntheses'
      )
      OR (
        "action" IN (
          'knowledge_import_previewed',
          'knowledge_import_committed',
          'knowledge_import_duplicate_detected',
          'knowledge_import_rejected'
        )
        AND "targetTable" = 'knowledge_imports'
      )
    )
  )
) NOT VALID;
