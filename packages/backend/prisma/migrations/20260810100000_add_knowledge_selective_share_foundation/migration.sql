-- Issue #2015 PR A: additive, rollback-safe Knowledge-to-Chat share storage.
-- ChatMessageType intentionally remains `text`; old applications continue to
-- render the constant, non-sensitive ChatMessage.body fallback.

CREATE TYPE "KnowledgeShareStatus" AS ENUM (
  'pending', 'posted', 'failed', 'revoked'
);

CREATE TYPE "KnowledgeShareFailureCode" AS ENUM (
  'source_unavailable', 'room_unavailable', 'post_rejected'
);

-- Optional, opaque notification claims make only Knowledge share Chat
-- notifications idempotent. Existing notification rows and producers retain
-- their current behavior because NULL values remain unrestricted.
ALTER TABLE "AppNotification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "AppNotification_dedupeKey_key"
  ON "AppNotification"("dedupeKey");

CREATE TABLE "KnowledgeShare" (
  "id" TEXT NOT NULL,
  "sourceKnowledgeItemId" TEXT NOT NULL,
  "sourceOwnerUserId" TEXT NOT NULL,
  "sharerUserId" TEXT NOT NULL,
  "chatPosterUserId" TEXT NOT NULL,
  "destinationRoomId" TEXT NOT NULL,
  "chatMessageId" TEXT,
  "selectionSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "requestKeyHash" TEXT NOT NULL,
  "requestPayloadHash" TEXT NOT NULL,
  "selectionHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "sourceItemVersion" INTEGER NOT NULL,
  "sourceItemUpdatedAt" TIMESTAMP(3) NOT NULL,
  "selectedTitle" TEXT,
  "selectedSourceType" "KnowledgeSourceType",
  "selectedCanonicalUrl" TEXT,
  "selectedSharerNote" TEXT,
  "status" "KnowledgeShareStatus" NOT NULL DEFAULT 'pending',
  "failureCode" "KnowledgeShareFailureCode",
  "version" INTEGER NOT NULL DEFAULT 1,
  "postedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeShare_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeShare_actor_check" CHECK (
    LENGTH(BTRIM("sourceOwnerUserId")) BETWEEN 1 AND 200
    AND LENGTH(BTRIM("sharerUserId")) BETWEEN 1 AND 200
    AND LENGTH(BTRIM("chatPosterUserId")) BETWEEN 1 AND 200
    AND "createdBy" = "sharerUserId"
    AND LENGTH(BTRIM("updatedBy")) BETWEEN 1 AND 200
  ),
  CONSTRAINT "KnowledgeShare_schema_version_check" CHECK (
    "selectionSchemaVersion" = 1
    AND "sourceItemVersion" >= 1
    AND "version" >= 1
  ),
  CONSTRAINT "KnowledgeShare_hash_check" CHECK (
    "requestKeyHash" ~ '^[0-9a-f]{64}$'
    AND "requestPayloadHash" ~ '^[0-9a-f]{64}$'
    AND "selectionHash" ~ '^[0-9a-f]{64}$'
    AND "contentHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "KnowledgeShare_selected_title_check" CHECK (
    "selectedTitle" IS NULL
    OR CHAR_LENGTH("selectedTitle") BETWEEN 1 AND 500
  ),
  CONSTRAINT "KnowledgeShare_selected_url_check" CHECK (
    "selectedCanonicalUrl" IS NULL
    OR OCTET_LENGTH("selectedCanonicalUrl") BETWEEN 1 AND 4096
  ),
  CONSTRAINT "KnowledgeShare_selected_note_check" CHECK (
    "selectedSharerNote" IS NULL
    OR OCTET_LENGTH("selectedSharerNote") BETWEEN 1 AND 4096
  ),
  CONSTRAINT "KnowledgeShare_state_shape_check" CHECK (
    (
      "status" = 'pending'
      AND "chatMessageId" IS NULL
      AND "failureCode" IS NULL
      AND "postedAt" IS NULL
      AND "failedAt" IS NULL
      AND "revokedAt" IS NULL
      AND "revokedBy" IS NULL
    )
    OR (
      "status" = 'posted'
      AND "chatMessageId" IS NOT NULL
      AND "failureCode" IS NULL
      AND "postedAt" IS NOT NULL
      AND "failedAt" IS NULL
      AND "revokedAt" IS NULL
      AND "revokedBy" IS NULL
    )
    OR (
      "status" = 'failed'
      AND "chatMessageId" IS NULL
      AND "failureCode" IS NOT NULL
      AND "postedAt" IS NULL
      AND "failedAt" IS NOT NULL
      AND "revokedAt" IS NULL
      AND "revokedBy" IS NULL
    )
    OR (
      "status" = 'revoked'
      AND "failureCode" IS NULL
      AND "failedAt" IS NULL
      AND "revokedAt" IS NOT NULL
      AND "revokedBy" IS NOT NULL
      AND (
        ("chatMessageId" IS NULL AND "postedAt" IS NULL)
        OR ("chatMessageId" IS NOT NULL AND "postedAt" IS NOT NULL)
      )
    )
  ),
  CONSTRAINT "KnowledgeShare_timestamp_order_check" CHECK (
    "updatedAt" >= "createdAt"
    AND ("postedAt" IS NULL OR "postedAt" >= "createdAt")
    AND ("failedAt" IS NULL OR "failedAt" >= "createdAt")
    AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
  )
);

CREATE TABLE "KnowledgeShareSnapshot" (
  "id" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "sourceKnowledgeItemId" TEXT NOT NULL,
  "sourceOwnerUserId" TEXT NOT NULL,
  "sourceSnapshotId" TEXT NOT NULL,
  "sourceSnapshotVersion" INTEGER NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "provenanceSelected" BOOLEAN NOT NULL,
  "excerptSelected" BOOLEAN NOT NULL,
  "excerpt" TEXT,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeShareSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeShareSnapshot_version_hash_check" CHECK (
    "sourceSnapshotVersion" >= 1
    AND "sourceSha256" ~ '^[0-9a-f]{64}$'
    AND "contentHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "KnowledgeShareSnapshot_selection_check" CHECK (
    ("provenanceSelected" OR "excerptSelected")
    AND (
      ("excerptSelected" AND "excerpt" IS NOT NULL
        AND OCTET_LENGTH("excerpt") BETWEEN 1 AND 4096)
      OR (NOT "excerptSelected" AND "excerpt" IS NULL)
    )
  )
);

CREATE TABLE "KnowledgeShareLabelSnapshot" (
  "id" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "sourceKnowledgeItemId" TEXT NOT NULL,
  "sourceOwnerUserId" TEXT NOT NULL,
  "sourceAssignmentId" TEXT NOT NULL,
  "sourceLabelId" TEXT NOT NULL,
  "sourceLabelVersion" INTEGER NOT NULL,
  "displayName" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeShareLabelSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeShareLabelSnapshot_bounds_check" CHECK (
    "sourceLabelVersion" >= 1
    AND "ordinal" BETWEEN 0 AND 19
    AND CHAR_LENGTH("displayName") BETWEEN 1 AND 200
    AND "contentHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE "KnowledgeShareAnnotationSnapshot" (
  "id" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "sourceKnowledgeItemId" TEXT NOT NULL,
  "sourceOwnerUserId" TEXT NOT NULL,
  "sourceAnnotationId" TEXT NOT NULL,
  "sourceRevisionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" "KnowledgeAnnotationKind" NOT NULL,
  "origin" "KnowledgeProvenanceOrigin" NOT NULL,
  "content" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeShareAnnotationSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeShareAnnotationSnapshot_bounds_check" CHECK (
    "revision" >= 1
    AND "ordinal" BETWEEN 0 AND 19
    AND OCTET_LENGTH("content") BETWEEN 1 AND 65536
    AND "contentHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE "KnowledgeShareTurnSnapshot" (
  "id" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "sourceKnowledgeItemId" TEXT NOT NULL,
  "sourceOwnerUserId" TEXT NOT NULL,
  "sourceConversationId" TEXT NOT NULL,
  "sourceConversationVersion" INTEGER NOT NULL,
  "sourceTurnId" TEXT NOT NULL,
  "role" "KnowledgeConversationRole" NOT NULL,
  "origin" "KnowledgeProvenanceOrigin" NOT NULL,
  "content" TEXT NOT NULL,
  "name" TEXT,
  "occurredAt" TIMESTAMP(3),
  "ordinal" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeShareTurnSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeShareTurnSnapshot_bounds_check" CHECK (
    "sourceConversationVersion" >= 1
    AND "ordinal" BETWEEN 0 AND 49
    AND OCTET_LENGTH("content") BETWEEN 1 AND 65536
    AND ("name" IS NULL OR CHAR_LENGTH("name") BETWEEN 1 AND 200)
    AND "contentHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "KnowledgeShareTurnSnapshot_role_origin_check" CHECK (
    ("role" = 'user' AND "origin" IN ('user', 'external'))
    OR ("role" = 'assistant' AND "origin" IN ('ai', 'external'))
    OR ("role" = 'system' AND "origin" = 'system')
    OR ("role" = 'tool' AND "origin" = 'tool')
  )
);

CREATE FUNCTION "erp4_knowledge_share_string_array_is_bounded"(
  value JSONB,
  max_items INTEGER,
  max_item_bytes INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT
    JSONB_TYPEOF(value) = 'array'
    AND JSONB_ARRAY_LENGTH(value) <= max_items
    AND NOT EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(value) AS element
      WHERE JSONB_TYPEOF(element) <> 'string'
        OR OCTET_LENGTH(element #>> '{}') NOT BETWEEN 1 AND max_item_bytes
    );
$$;

CREATE TABLE "KnowledgeShareSynthesisSnapshot" (
  "id" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "sourceKnowledgeItemId" TEXT NOT NULL,
  "sourceOwnerUserId" TEXT NOT NULL,
  "sourceSynthesisId" TEXT NOT NULL,
  "sourceSynthesisVersionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "confidenceBasisPoints" INTEGER,
  "unresolvedQuestions" JSONB NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeShareSynthesisSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeShareSynthesisSnapshot_bounds_check" CHECK (
    "version" >= 1
    AND "ordinal" BETWEEN 0 AND 9
    AND CHAR_LENGTH("title") BETWEEN 1 AND 500
    AND OCTET_LENGTH("content") BETWEEN 1 AND 262144
    AND ("confidenceBasisPoints" IS NULL
      OR "confidenceBasisPoints" BETWEEN 0 AND 10000)
    AND "erp4_knowledge_share_string_array_is_bounded"(
      "unresolvedQuestions", 50, 4096
    )
    AND "contentHash" ~ '^[0-9a-f]{64}$'
  )
);

-- Composite keys make every copied immutable source version verifiable by an
-- FK without changing any existing row or source table column.
CREATE UNIQUE INDEX "KnowledgeSnapshot_id_knowledgeItemId_version_key"
  ON "KnowledgeSnapshot"("id", "knowledgeItemId", "version");
CREATE UNIQUE INDEX "KnowledgeItemLabel_id_knowledgeItemId_labelId_key"
  ON "KnowledgeItemLabel"("id", "knowledgeItemId", "labelId");
CREATE UNIQUE INDEX "KnowledgeAnnotation_id_knowledgeItemId_ownerUserId_key"
  ON "KnowledgeAnnotation"("id", "knowledgeItemId", "ownerUserId");
CREATE UNIQUE INDEX "KnowledgeAnnotationRevision_id_annotationId_revision_key"
  ON "KnowledgeAnnotationRevision"("id", "annotationId", "revision");
CREATE UNIQUE INDEX "KnowledgeConversationTurn_id_conversationId_key"
  ON "KnowledgeConversationTurn"("id", "conversationId");
CREATE UNIQUE INDEX "KnowledgeSynthesis_id_ownerUserId_key"
  ON "KnowledgeSynthesis"("id", "ownerUserId");
CREATE UNIQUE INDEX "KnowledgeSynthesisVersion_id_synthesisId_version_key"
  ON "KnowledgeSynthesisVersion"("id", "synthesisId", "version");

CREATE UNIQUE INDEX "KnowledgeShare_chatMessageId_key"
  ON "KnowledgeShare"("chatMessageId");
CREATE UNIQUE INDEX "KnowledgeShare_sharerUserId_requestKeyHash_key"
  ON "KnowledgeShare"("sharerUserId", "requestKeyHash");
CREATE UNIQUE INDEX "KnowledgeShare_id_sourceKnowledgeItemId_sourceOwnerUserId_key"
  ON "KnowledgeShare"("id", "sourceKnowledgeItemId", "sourceOwnerUserId");
CREATE UNIQUE INDEX "KnowledgeShare_chatMessageId_destinationRoomId_key"
  ON "KnowledgeShare"("chatMessageId", "destinationRoomId");
CREATE INDEX "KnowledgeShare_sourceKnowledgeItemId_sourceOwnerUserId_crea_idx"
  ON "KnowledgeShare"("sourceKnowledgeItemId", "sourceOwnerUserId", "createdAt", "id");
CREATE INDEX "KnowledgeShare_destinationRoomId_status_createdAt_id_idx"
  ON "KnowledgeShare"("destinationRoomId", "status", "createdAt", "id");
CREATE INDEX "KnowledgeShare_sharerUserId_status_createdAt_id_idx"
  ON "KnowledgeShare"("sharerUserId", "status", "createdAt", "id");
CREATE INDEX "KnowledgeShare_chatPosterUserId_status_createdAt_id_idx"
  ON "KnowledgeShare"("chatPosterUserId", "status", "createdAt", "id");
CREATE INDEX "KnowledgeShare_status_createdAt_id_idx"
  ON "KnowledgeShare"("status", "createdAt", "id");

CREATE UNIQUE INDEX "KnowledgeShareSnapshot_shareId_key"
  ON "KnowledgeShareSnapshot"("shareId");
CREATE UNIQUE INDEX "KnowledgeShareSnapshot_shareId_sourceKnowledgeItemId_source_key"
  ON "KnowledgeShareSnapshot"("shareId", "sourceKnowledgeItemId", "sourceOwnerUserId");
CREATE INDEX "KnowledgeShareSnapshot_sourceSnapshotId_sourceKnowledgeItem_idx"
  ON "KnowledgeShareSnapshot"("sourceSnapshotId", "sourceKnowledgeItemId", "sourceSnapshotVersion");

CREATE UNIQUE INDEX "KnowledgeShareLabelSnapshot_shareId_ordinal_key"
  ON "KnowledgeShareLabelSnapshot"("shareId", "ordinal");
CREATE UNIQUE INDEX "KnowledgeShareLabelSnapshot_shareId_sourceAssignmentId_key"
  ON "KnowledgeShareLabelSnapshot"("shareId", "sourceAssignmentId");
CREATE INDEX "KnowledgeShareLabelSnapshot_sourceAssignmentId_sourceKnowle_idx"
  ON "KnowledgeShareLabelSnapshot"("sourceAssignmentId", "sourceKnowledgeItemId", "sourceLabelId");
CREATE INDEX "KnowledgeShareLabelSnapshot_sourceLabelId_idx"
  ON "KnowledgeShareLabelSnapshot"("sourceLabelId");

CREATE UNIQUE INDEX "KnowledgeShareAnnotationSnapshot_shareId_ordinal_key"
  ON "KnowledgeShareAnnotationSnapshot"("shareId", "ordinal");
CREATE UNIQUE INDEX "KnowledgeShareAnnotationSnapshot_shareId_sourceRevisionId_key"
  ON "KnowledgeShareAnnotationSnapshot"("shareId", "sourceRevisionId");
CREATE INDEX "KnowledgeShareAnnotationSnapshot_sourceAnnotationId_sourceK_idx"
  ON "KnowledgeShareAnnotationSnapshot"("sourceAnnotationId", "sourceKnowledgeItemId", "sourceOwnerUserId");
CREATE INDEX "KnowledgeShareAnnotationSnapshot_sourceRevisionId_sourceAnn_idx"
  ON "KnowledgeShareAnnotationSnapshot"("sourceRevisionId", "sourceAnnotationId", "revision");

CREATE UNIQUE INDEX "KnowledgeShareTurnSnapshot_shareId_ordinal_key"
  ON "KnowledgeShareTurnSnapshot"("shareId", "ordinal");
CREATE UNIQUE INDEX "KnowledgeShareTurnSnapshot_shareId_sourceTurnId_key"
  ON "KnowledgeShareTurnSnapshot"("shareId", "sourceTurnId");
CREATE INDEX "KnowledgeShareTurnSnapshot_sourceConversationId_sourceOwner_idx"
  ON "KnowledgeShareTurnSnapshot"("sourceConversationId", "sourceOwnerUserId");
CREATE INDEX "KnowledgeShareTurnSnapshot_sourceConversationId_sourceKnowl_idx"
  ON "KnowledgeShareTurnSnapshot"("sourceConversationId", "sourceKnowledgeItemId");
CREATE INDEX "KnowledgeShareTurnSnapshot_sourceTurnId_sourceConversationI_idx"
  ON "KnowledgeShareTurnSnapshot"("sourceTurnId", "sourceConversationId");

CREATE UNIQUE INDEX "KnowledgeShareSynthesisSnapshot_shareId_ordinal_key"
  ON "KnowledgeShareSynthesisSnapshot"("shareId", "ordinal");
CREATE UNIQUE INDEX "KnowledgeShareSynthesisSnapshot_shareId_sourceSynthesisVers_key"
  ON "KnowledgeShareSynthesisSnapshot"("shareId", "sourceSynthesisVersionId");
CREATE INDEX "KnowledgeShareSynthesisSnapshot_sourceSynthesisId_sourceOwn_idx"
  ON "KnowledgeShareSynthesisSnapshot"("sourceSynthesisId", "sourceOwnerUserId");
CREATE INDEX "KnowledgeShareSynthesisSnapshot_sourceSynthesisVersionId_so_idx"
  ON "KnowledgeShareSynthesisSnapshot"("sourceSynthesisVersionId", "sourceSynthesisId", "version");

ALTER TABLE "KnowledgeShare"
  ADD CONSTRAINT "KnowledgeShare_sourceKnowledgeItemId_sourceOwnerUserId_fkey"
  FOREIGN KEY ("sourceKnowledgeItemId", "sourceOwnerUserId")
  REFERENCES "KnowledgeItem"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShare_destinationRoomId_fkey"
  FOREIGN KEY ("destinationRoomId") REFERENCES "ChatRoom"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShare_chatMessageId_destinationRoomId_fkey"
  FOREIGN KEY ("chatMessageId", "destinationRoomId")
  REFERENCES "ChatMessage"("id", "roomId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeShareSnapshot"
  ADD CONSTRAINT "KnowledgeShareSnapshot_shareId_sourceKnowledgeItemId_sourc_fkey"
  FOREIGN KEY ("shareId", "sourceKnowledgeItemId", "sourceOwnerUserId")
  REFERENCES "KnowledgeShare"("id", "sourceKnowledgeItemId", "sourceOwnerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareSnapshot_sourceSnapshotId_sourceKnowledgeIte_fkey"
  FOREIGN KEY ("sourceSnapshotId", "sourceKnowledgeItemId", "sourceSnapshotVersion")
  REFERENCES "KnowledgeSnapshot"("id", "knowledgeItemId", "version")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeShareLabelSnapshot"
  ADD CONSTRAINT "KnowledgeShareLabelSnapshot_shareId_sourceKnowledgeItemId__fkey"
  FOREIGN KEY ("shareId", "sourceKnowledgeItemId", "sourceOwnerUserId")
  REFERENCES "KnowledgeShare"("id", "sourceKnowledgeItemId", "sourceOwnerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareLabelSnapshot_sourceAssignmentId_sourceKnowl_fkey"
  FOREIGN KEY ("sourceAssignmentId", "sourceKnowledgeItemId", "sourceLabelId")
  REFERENCES "KnowledgeItemLabel"("id", "knowledgeItemId", "labelId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareLabelSnapshot_sourceLabelId_fkey"
  FOREIGN KEY ("sourceLabelId") REFERENCES "KnowledgeLabel"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeShareAnnotationSnapshot"
  ADD CONSTRAINT "KnowledgeShareAnnotationSnapshot_shareId_sourceKnowledgeIt_fkey"
  FOREIGN KEY ("shareId", "sourceKnowledgeItemId", "sourceOwnerUserId")
  REFERENCES "KnowledgeShare"("id", "sourceKnowledgeItemId", "sourceOwnerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareAnnotationSnapshot_sourceAnnotationId_source_fkey"
  FOREIGN KEY ("sourceAnnotationId", "sourceKnowledgeItemId", "sourceOwnerUserId")
  REFERENCES "KnowledgeAnnotation"("id", "knowledgeItemId", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareAnnotationSnapshot_sourceRevisionId_sourceAn_fkey"
  FOREIGN KEY ("sourceRevisionId", "sourceAnnotationId", "revision")
  REFERENCES "KnowledgeAnnotationRevision"("id", "annotationId", "revision")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeShareTurnSnapshot"
  ADD CONSTRAINT "KnowledgeShareTurnSnapshot_shareId_sourceKnowledgeItemId_s_fkey"
  FOREIGN KEY ("shareId", "sourceKnowledgeItemId", "sourceOwnerUserId")
  REFERENCES "KnowledgeShare"("id", "sourceKnowledgeItemId", "sourceOwnerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareTurnSnapshot_sourceConversationId_sourceOwne_fkey"
  FOREIGN KEY ("sourceConversationId", "sourceOwnerUserId")
  REFERENCES "KnowledgeConversation"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareTurnSnapshot_sourceConversationId_sourceKnow_fkey"
  FOREIGN KEY ("sourceConversationId", "sourceKnowledgeItemId")
  REFERENCES "KnowledgeConversationItem"("conversationId", "knowledgeItemId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareTurnSnapshot_sourceTurnId_sourceConversation_fkey"
  FOREIGN KEY ("sourceTurnId", "sourceConversationId")
  REFERENCES "KnowledgeConversationTurn"("id", "conversationId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeShareSynthesisSnapshot"
  ADD CONSTRAINT "KnowledgeShareSynthesisSnapshot_shareId_sourceKnowledgeIte_fkey"
  FOREIGN KEY ("shareId", "sourceKnowledgeItemId", "sourceOwnerUserId")
  REFERENCES "KnowledgeShare"("id", "sourceKnowledgeItemId", "sourceOwnerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareSynthesisSnapshot_sourceSynthesisId_sourceOw_fkey"
  FOREIGN KEY ("sourceSynthesisId", "sourceOwnerUserId")
  REFERENCES "KnowledgeSynthesis"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "KnowledgeShareSynthesisSnapshot_sourceSynthesisVersionId_s_fkey"
  FOREIGN KEY ("sourceSynthesisVersionId", "sourceSynthesisId", "version")
  REFERENCES "KnowledgeSynthesisVersion"("id", "synthesisId", "version")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "erp4_enforce_knowledge_share_state"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_item "KnowledgeItem"%ROWTYPE;
  message_row "ChatMessage"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'pending' THEN
      RAISE EXCEPTION 'knowledge share must be created pending'
        USING ERRCODE = '23514',
              CONSTRAINT = 'KnowledgeShare_initial_state_check';
    END IF;

    SELECT * INTO source_item
      FROM "KnowledgeItem"
     WHERE "id" = NEW."sourceKnowledgeItemId"
       AND "ownerUserId" = NEW."sourceOwnerUserId"
     FOR SHARE;
    IF NOT FOUND
      OR source_item."deletedAt" IS NOT NULL
      OR source_item."version" <> NEW."sourceItemVersion"
      OR source_item."updatedAt" <> NEW."sourceItemUpdatedAt"
      OR (NEW."selectedTitle" IS NOT NULL
        AND NEW."selectedTitle" IS DISTINCT FROM source_item."title")
      OR (NEW."selectedSourceType" IS NOT NULL
        AND NEW."selectedSourceType" IS DISTINCT FROM source_item."sourceType")
    THEN
      RAISE EXCEPTION 'knowledge share source boundary is stale'
        USING ERRCODE = '23514',
              CONSTRAINT = 'KnowledgeShare_source_boundary_check';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."sourceKnowledgeItemId" IS DISTINCT FROM OLD."sourceKnowledgeItemId"
    OR NEW."sourceOwnerUserId" IS DISTINCT FROM OLD."sourceOwnerUserId"
    OR NEW."sharerUserId" IS DISTINCT FROM OLD."sharerUserId"
    OR NEW."chatPosterUserId" IS DISTINCT FROM OLD."chatPosterUserId"
    OR NEW."destinationRoomId" IS DISTINCT FROM OLD."destinationRoomId"
    OR NEW."selectionSchemaVersion" IS DISTINCT FROM OLD."selectionSchemaVersion"
    OR NEW."requestKeyHash" IS DISTINCT FROM OLD."requestKeyHash"
    OR NEW."requestPayloadHash" IS DISTINCT FROM OLD."requestPayloadHash"
    OR NEW."selectionHash" IS DISTINCT FROM OLD."selectionHash"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."sourceItemVersion" IS DISTINCT FROM OLD."sourceItemVersion"
    OR NEW."sourceItemUpdatedAt" IS DISTINCT FROM OLD."sourceItemUpdatedAt"
    OR NEW."selectedTitle" IS DISTINCT FROM OLD."selectedTitle"
    OR NEW."selectedSourceType" IS DISTINCT FROM OLD."selectedSourceType"
    OR NEW."selectedCanonicalUrl" IS DISTINCT FROM OLD."selectedCanonicalUrl"
    OR NEW."selectedSharerNote" IS DISTINCT FROM OLD."selectedSharerNote"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
  THEN
    RAISE EXCEPTION 'knowledge share selection is immutable'
      USING ERRCODE = '55000',
            CONSTRAINT = 'KnowledgeShare_selection_immutable';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF NEW."chatMessageId" IS DISTINCT FROM OLD."chatMessageId"
      OR NEW."failureCode" IS DISTINCT FROM OLD."failureCode"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."failedAt" IS DISTINCT FROM OLD."failedAt"
      OR NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
      OR NEW."revokedBy" IS DISTINCT FROM OLD."revokedBy"
      OR NEW."version" IS DISTINCT FROM OLD."version"
    THEN
      RAISE EXCEPTION 'knowledge share state mutation requires a transition'
        USING ERRCODE = '23514',
              CONSTRAINT = 'KnowledgeShare_state_transition_check';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'pending' AND NEW."status" IN ('posted', 'failed', 'revoked'))
    OR (OLD."status" = 'posted' AND NEW."status" = 'revoked')
  ) OR NEW."version" <> OLD."version" + 1
  THEN
    RAISE EXCEPTION 'invalid knowledge share state transition'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeShare_state_transition_check';
  END IF;

  IF OLD."status" = 'posted' AND (
    NEW."chatMessageId" IS DISTINCT FROM OLD."chatMessageId"
    OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
  ) THEN
    RAISE EXCEPTION 'posted knowledge share reference is immutable'
      USING ERRCODE = '55000',
            CONSTRAINT = 'KnowledgeShare_posted_reference_immutable';
  END IF;

  IF NEW."chatMessageId" IS NOT NULL THEN
    SELECT * INTO message_row
      FROM "ChatMessage"
     WHERE "id" = NEW."chatMessageId"
       AND "roomId" = NEW."destinationRoomId"
     FOR UPDATE;
    IF NOT FOUND
      OR message_row."parentMessageId" IS NOT NULL
      OR message_row."threadRootId" IS NOT NULL
      OR message_row."messageType" <> 'text'
      OR message_row."userId" IS DISTINCT FROM NEW."chatPosterUserId"
      OR message_row."body" IS DISTINCT FROM 'Knowledge was shared.'
      OR message_row."deletedAt" IS NOT NULL
    THEN
      RAISE EXCEPTION 'knowledge share reference must be a text root in the destination room'
        USING ERRCODE = '23514',
              CONSTRAINT = 'KnowledgeShare_chat_root_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeShare_state_trigger"
BEFORE INSERT OR UPDATE ON "KnowledgeShare"
FOR EACH ROW
EXECUTE FUNCTION "erp4_enforce_knowledge_share_state"();

CREATE FUNCTION "erp4_preserve_knowledge_share_chat_root"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
    FROM "KnowledgeShare" AS share
    WHERE share."chatMessageId" = OLD."id"
      AND share."status" IN ('posted', 'revoked')
  ) THEN
    RAISE EXCEPTION 'knowledge share chat root is immutable; revoke the share instead'
      USING ERRCODE = '55000',
            CONSTRAINT = 'ChatMessage_knowledge_share_root_immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM "KnowledgeShare" AS share
    WHERE share."chatMessageId" = OLD."id"
      AND share."status" IN ('posted', 'revoked')
  ) AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."roomId" IS DISTINCT FROM OLD."roomId"
    OR NEW."parentMessageId" IS DISTINCT FROM OLD."parentMessageId"
    OR NEW."threadRootId" IS DISTINCT FROM OLD."threadRootId"
    OR NEW."messageType" IS DISTINCT FROM OLD."messageType"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."body" IS DISTINCT FROM OLD."body"
    OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt"
    OR NEW."deletedReason" IS DISTINCT FROM OLD."deletedReason"
  ) THEN
    RAISE EXCEPTION 'knowledge share chat root is immutable; revoke the share instead'
      USING ERRCODE = '55000',
            CONSTRAINT = 'ChatMessage_knowledge_share_root_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "ChatMessage_knowledge_share_root_immutable_trigger"
BEFORE UPDATE OR DELETE ON "ChatMessage"
FOR EACH ROW
EXECUTE FUNCTION "erp4_preserve_knowledge_share_chat_root"();

CREATE FUNCTION "erp4_lock_pending_knowledge_share"(
  share_id TEXT,
  snapshot_creator TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  share_status "KnowledgeShareStatus";
  share_sharer TEXT;
BEGIN
  SELECT "status", "sharerUserId" INTO share_status, share_sharer
    FROM "KnowledgeShare"
   WHERE "id" = share_id
   FOR UPDATE;
  IF NOT FOUND OR share_status <> 'pending' OR snapshot_creator <> share_sharer THEN
    RAISE EXCEPTION 'knowledge share snapshot can only be appended while pending'
      USING ERRCODE = '55000',
            CONSTRAINT = 'KnowledgeShareSnapshot_pending_parent_check';
  END IF;
END;
$$;

CREATE FUNCTION "erp4_validate_knowledge_share_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_status "KnowledgeSnapshotStatus";
  source_hash TEXT;
BEGIN
  PERFORM "erp4_lock_pending_knowledge_share"(NEW."shareId", NEW."createdBy");
  SELECT "status", "sha256" INTO source_status, source_hash
    FROM "KnowledgeSnapshot"
   WHERE "id" = NEW."sourceSnapshotId"
     AND "knowledgeItemId" = NEW."sourceKnowledgeItemId"
     AND "version" = NEW."sourceSnapshotVersion"
   FOR SHARE;
  IF NOT FOUND OR source_status <> 'ready' OR source_hash IS NULL
    OR source_hash <> NEW."sourceSha256"
  THEN
    RAISE EXCEPTION 'knowledge share snapshot source is stale'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeShareSnapshot_source_boundary_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "erp4_validate_knowledge_share_label_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_version INTEGER;
  source_name TEXT;
  assignment_detached TIMESTAMP(3);
  label_deleted TIMESTAMP(3);
BEGIN
  PERFORM "erp4_lock_pending_knowledge_share"(NEW."shareId", NEW."createdBy");
  SELECT label."version", label."displayName", assignment."detachedAt", label."deletedAt"
    INTO source_version, source_name, assignment_detached, label_deleted
    FROM "KnowledgeItemLabel" AS assignment
    JOIN "KnowledgeLabel" AS label ON label."id" = assignment."labelId"
   WHERE assignment."id" = NEW."sourceAssignmentId"
     AND assignment."knowledgeItemId" = NEW."sourceKnowledgeItemId"
     AND assignment."labelId" = NEW."sourceLabelId"
   FOR SHARE OF assignment, label;
  IF NOT FOUND OR assignment_detached IS NOT NULL OR label_deleted IS NOT NULL
    OR source_version <> NEW."sourceLabelVersion"
    OR source_name <> NEW."displayName"
  THEN
    RAISE EXCEPTION 'knowledge share label source is stale'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeShareLabelSnapshot_source_boundary_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "erp4_validate_knowledge_share_annotation_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_kind "KnowledgeAnnotationKind";
  source_origin "KnowledgeProvenanceOrigin";
  source_content TEXT;
  source_deleted TIMESTAMP(3);
  source_current_revision INTEGER;
BEGIN
  PERFORM "erp4_lock_pending_knowledge_share"(NEW."shareId", NEW."createdBy");
  SELECT revision."kind", revision."origin", revision."content",
         annotation."deletedAt", annotation."currentRevision"
    INTO source_kind, source_origin, source_content,
         source_deleted, source_current_revision
    FROM "KnowledgeAnnotationRevision" AS revision
    JOIN "KnowledgeAnnotation" AS annotation
      ON annotation."id" = revision."annotationId"
   WHERE revision."id" = NEW."sourceRevisionId"
     AND revision."annotationId" = NEW."sourceAnnotationId"
     AND revision."revision" = NEW."revision"
     AND annotation."knowledgeItemId" = NEW."sourceKnowledgeItemId"
     AND annotation."ownerUserId" = NEW."sourceOwnerUserId"
   FOR SHARE OF revision, annotation;
  IF NOT FOUND OR source_deleted IS NOT NULL
    OR source_current_revision <> NEW."revision"
    OR source_kind <> NEW."kind"
    OR source_origin <> NEW."origin"
    OR source_content <> NEW."content"
  THEN
    RAISE EXCEPTION 'knowledge share annotation source is stale'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeShareAnnotationSnapshot_source_boundary_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "erp4_validate_knowledge_share_turn_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  conversation_version INTEGER;
  conversation_deleted TIMESTAMP(3);
  source_role "KnowledgeConversationRole";
  source_origin "KnowledgeProvenanceOrigin";
  source_content TEXT;
  source_name TEXT;
  source_occurred_at TIMESTAMP(3);
BEGIN
  PERFORM "erp4_lock_pending_knowledge_share"(NEW."shareId", NEW."createdBy");
  SELECT conversation."version", conversation."deletedAt",
         turn."role", turn."origin", turn."content", turn."name", turn."occurredAt"
    INTO conversation_version, conversation_deleted,
         source_role, source_origin, source_content, source_name, source_occurred_at
    FROM "KnowledgeConversationTurn" AS turn
    JOIN "KnowledgeConversation" AS conversation
      ON conversation."id" = turn."conversationId"
    JOIN "KnowledgeConversationItem" AS item_link
      ON item_link."conversationId" = conversation."id"
     AND item_link."knowledgeItemId" = NEW."sourceKnowledgeItemId"
   WHERE turn."id" = NEW."sourceTurnId"
     AND turn."conversationId" = NEW."sourceConversationId"
     AND conversation."ownerUserId" = NEW."sourceOwnerUserId"
   FOR SHARE OF turn, conversation, item_link;
  IF NOT FOUND OR conversation_deleted IS NOT NULL
    OR conversation_version <> NEW."sourceConversationVersion"
    OR source_role <> NEW."role"
    OR source_origin <> NEW."origin"
    OR source_content <> NEW."content"
    OR source_name IS DISTINCT FROM NEW."name"
    OR source_occurred_at IS DISTINCT FROM NEW."occurredAt"
  THEN
    RAISE EXCEPTION 'knowledge share turn source is stale'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeShareTurnSnapshot_source_boundary_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "erp4_validate_knowledge_share_synthesis_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_title TEXT;
  source_content TEXT;
  source_confidence INTEGER;
  source_questions JSONB;
  source_deleted TIMESTAMP(3);
  source_current_version INTEGER;
BEGIN
  PERFORM "erp4_lock_pending_knowledge_share"(NEW."shareId", NEW."createdBy");
  SELECT synthesis."title", version."content", version."confidenceBasisPoints",
         version."unresolvedQuestions", synthesis."deletedAt",
         synthesis."currentVersion"
    INTO source_title, source_content, source_confidence,
         source_questions, source_deleted, source_current_version
    FROM "KnowledgeSynthesisVersion" AS version
    JOIN "KnowledgeSynthesis" AS synthesis
      ON synthesis."id" = version."synthesisId"
   WHERE version."id" = NEW."sourceSynthesisVersionId"
     AND version."synthesisId" = NEW."sourceSynthesisId"
     AND version."version" = NEW."version"
     AND synthesis."ownerUserId" = NEW."sourceOwnerUserId"
   FOR SHARE OF version, synthesis;
  IF NOT FOUND OR source_deleted IS NOT NULL
    OR source_current_version <> NEW."version"
    OR source_title <> NEW."title"
    OR source_content <> NEW."content"
    OR source_confidence IS DISTINCT FROM NEW."confidenceBasisPoints"
    OR source_questions <> NEW."unresolvedQuestions"
  THEN
    RAISE EXCEPTION 'knowledge share synthesis source is stale'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeShareSynthesisSnapshot_source_boundary_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeShareSnapshot_source_trigger"
BEFORE INSERT ON "KnowledgeShareSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_validate_knowledge_share_snapshot"();
CREATE TRIGGER "KnowledgeShareLabelSnapshot_source_trigger"
BEFORE INSERT ON "KnowledgeShareLabelSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_validate_knowledge_share_label_snapshot"();
CREATE TRIGGER "KnowledgeShareAnnotationSnapshot_source_trigger"
BEFORE INSERT ON "KnowledgeShareAnnotationSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_validate_knowledge_share_annotation_snapshot"();
CREATE TRIGGER "KnowledgeShareTurnSnapshot_source_trigger"
BEFORE INSERT ON "KnowledgeShareTurnSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_validate_knowledge_share_turn_snapshot"();
CREATE TRIGGER "KnowledgeShareSynthesisSnapshot_source_trigger"
BEFORE INSERT ON "KnowledgeShareSynthesisSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_validate_knowledge_share_synthesis_snapshot"();

CREATE FUNCTION "erp4_reject_knowledge_share_history_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable knowledge share history cannot be updated or deleted'
    USING ERRCODE = '55000',
          CONSTRAINT = 'KnowledgeShare_history_immutable';
END;
$$;

CREATE TRIGGER "KnowledgeShare_delete_immutable_trigger"
BEFORE DELETE ON "KnowledgeShare"
FOR EACH ROW EXECUTE FUNCTION "erp4_reject_knowledge_share_history_mutation"();
CREATE TRIGGER "KnowledgeShareSnapshot_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeShareSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_reject_knowledge_share_history_mutation"();
CREATE TRIGGER "KnowledgeShareLabelSnapshot_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeShareLabelSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_reject_knowledge_share_history_mutation"();
CREATE TRIGGER "KnowledgeShareAnnotationSnapshot_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeShareAnnotationSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_reject_knowledge_share_history_mutation"();
CREATE TRIGGER "KnowledgeShareTurnSnapshot_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeShareTurnSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_reject_knowledge_share_history_mutation"();
CREATE TRIGGER "KnowledgeShareSynthesisSnapshot_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeShareSynthesisSnapshot"
FOR EACH ROW EXECUTE FUNCTION "erp4_reject_knowledge_share_history_mutation"();

CREATE FUNCTION "erp4_enforce_knowledge_share_nonempty_selection"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "KnowledgeShare" AS share
    WHERE share."id" = NEW."id"
      AND (
        share."selectedTitle" IS NOT NULL
        OR share."selectedSourceType" IS NOT NULL
        OR share."selectedCanonicalUrl" IS NOT NULL
        OR share."selectedSharerNote" IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM "KnowledgeShareSnapshot" AS snapshot
          WHERE snapshot."shareId" = share."id"
        )
        OR EXISTS (
          SELECT 1 FROM "KnowledgeShareLabelSnapshot" AS label
          WHERE label."shareId" = share."id"
        )
        OR EXISTS (
          SELECT 1 FROM "KnowledgeShareAnnotationSnapshot" AS annotation
          WHERE annotation."shareId" = share."id"
        )
        OR EXISTS (
          SELECT 1 FROM "KnowledgeShareTurnSnapshot" AS turn
          WHERE turn."shareId" = share."id"
        )
        OR EXISTS (
          SELECT 1 FROM "KnowledgeShareSynthesisSnapshot" AS synthesis
          WHERE synthesis."shareId" = share."id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'knowledge share selection must not be empty'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeShare_nonempty_selection_check';
  END IF;
  RETURN NEW;
END;
$$;

-- Deferred so a transaction can insert the aggregate before its typed child
-- snapshots while still rejecting an empty aggregate at commit.
CREATE CONSTRAINT TRIGGER "KnowledgeShare_nonempty_selection_trigger"
AFTER INSERT ON "KnowledgeShare"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "erp4_enforce_knowledge_share_nonempty_selection"();

-- Scope mandatory Knowledge share audit actions to their aggregate without
-- validating unrelated historical rows during this expand-only migration.
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_knowledge_share_target_check" CHECK (
    "action" NOT IN (
      'knowledge_share_previewed',
      'knowledge_share_requested',
      'knowledge_share_posted',
      'knowledge_share_failed',
      'knowledge_share_reconciled',
      'knowledge_share_duplicate_detected',
      'knowledge_share_revoked'
    )
    OR (
      "targetTable" = 'knowledge_shares'
      AND "targetId" IS NOT NULL
    )
  ) NOT VALID;
