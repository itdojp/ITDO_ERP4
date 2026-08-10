-- Expand-only foundation for explicitly promoting selected Chat thread replies
-- to a new Knowledge synthesis. Existing Chat and Knowledge rows are neither
-- rewritten nor deleted; old applications can continue to ignore these tables.

CREATE TYPE "KnowledgeThreadPromotionAuthorCategory" AS ENUM (
  'user'
);

ALTER TABLE "KnowledgeSynthesisSource"
  ADD COLUMN "sourceThreadPromotionId" TEXT;

CREATE TABLE "KnowledgeThreadPromotion" (
  "id" TEXT NOT NULL,
  "sourceShareId" TEXT NOT NULL,
  "sourceShareVersion" INTEGER NOT NULL,
  "sourceShareContentHash" TEXT NOT NULL,
  "sourceRoomId" TEXT NOT NULL,
  "sourceRootMessageId" TEXT NOT NULL,
  "promoterUserId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "scope" "KnowledgeItemScope" NOT NULL,
  "organizationId" TEXT,
  "destinationSynthesisId" TEXT NOT NULL,
  "destinationSynthesisVersionId" TEXT NOT NULL,
  "destinationSynthesisVersionNumber" INTEGER NOT NULL DEFAULT 1,
  "previewSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "selectionHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "includesSharedCard" BOOLEAN NOT NULL DEFAULT false,
  "selectedMessageCount" INTEGER NOT NULL,
  "destinationGrantCount" INTEGER NOT NULL DEFAULT 0,
  "destinationGrantHash" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeThreadPromotion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeThreadPromotion_identity_check" CHECK (
    LENGTH(BTRIM("sourceShareId")) > 0
    AND LENGTH(BTRIM("sourceRoomId")) > 0
    AND LENGTH(BTRIM("sourceRootMessageId")) > 0
    AND LENGTH(BTRIM("promoterUserId")) > 0
    AND LENGTH(BTRIM("ownerUserId")) > 0
    AND LENGTH(BTRIM("createdBy")) > 0
  ),
  CONSTRAINT "KnowledgeThreadPromotion_version_hash_check" CHECK (
    "sourceShareVersion" >= 1
    AND "sourceShareContentHash" ~ '^[0-9a-f]{64}$'
    AND "previewSchemaVersion" = 1
    AND "version" = 1
    AND "destinationSynthesisVersionNumber" = 1
  ),
  CONSTRAINT "KnowledgeThreadPromotion_content_binding_check" CHECK (
    "selectionHash" ~ '^[0-9a-f]{64}$'
    AND "contentHash" ~ '^[0-9a-f]{64}$'
    AND (
      NOT "includesSharedCard"
      OR "sourceShareContentHash" ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT "KnowledgeThreadPromotion_selection_bounds_check" CHECK (
    "selectedMessageCount" BETWEEN 1 AND 100
  ),
  CONSTRAINT "KnowledgeThreadPromotion_scope_grants_check" CHECK (
    (
      "scope" = 'personal'
      AND "organizationId" IS NULL
      AND "destinationGrantCount" = 0
      AND "destinationGrantHash" IS NULL
    )
    OR (
      "scope" = 'organization'
      AND "organizationId" IS NOT NULL
      AND LENGTH(BTRIM("organizationId")) > 0
      AND "destinationGrantCount" BETWEEN 1 AND 20
      AND "destinationGrantHash" ~ '^[0-9a-f]{64}$'
    )
  )
);

COMMENT ON COLUMN "KnowledgeThreadPromotion"."contentHash" IS
  'SHA-256 of canonical promotion content including includesSharedCard, ordered selected reply hashes, destination scope and grant hash';

CREATE TABLE "KnowledgeThreadPromotionMessage" (
  "id" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "sourceRoomId" TEXT NOT NULL,
  "sourceRootMessageId" TEXT NOT NULL,
  "sourceMessageId" TEXT NOT NULL,
  "sourceActivitySequence" BIGINT NOT NULL,
  "sourceMessageCreatedAt" TIMESTAMP(3) NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "authorCategory" "KnowledgeThreadPromotionAuthorCategory" NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeThreadPromotionMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeThreadPromotionMessage_identity_check" CHECK (
    LENGTH(BTRIM("promotionId")) > 0
    AND LENGTH(BTRIM("sourceRoomId")) > 0
    AND LENGTH(BTRIM("sourceRootMessageId")) > 0
    AND LENGTH(BTRIM("sourceMessageId")) > 0
    AND "sourceMessageId" <> "sourceRootMessageId"
    AND LENGTH(BTRIM("createdBy")) > 0
  ),
  CONSTRAINT "KnowledgeThreadPromotionMessage_snapshot_check" CHECK (
    "sourceActivitySequence" > 0
    AND "ordinal" BETWEEN 0 AND 99
    AND OCTET_LENGTH("content") BETWEEN 1 AND 65536
    AND "contentHash" ~ '^[0-9a-f]{64}$'
    AND "createdAt" >= "sourceMessageCreatedAt"
  )
);

CREATE TABLE "KnowledgeThreadPromotionRequest" (
  "id" TEXT NOT NULL,
  "promoterUserId" TEXT NOT NULL,
  "requestKeyHash" TEXT NOT NULL,
  "requestPayloadHash" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeThreadPromotionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeThreadPromotionRequest_hash_check" CHECK (
    "requestKeyHash" ~ '^[0-9a-f]{64}$'
    AND "requestPayloadHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "KnowledgeThreadPromotionRequest_identity_check" CHECK (
    LENGTH(BTRIM("promoterUserId")) > 0
    AND LENGTH(BTRIM("promotionId")) > 0
    AND LENGTH(BTRIM("createdBy")) > 0
  )
);

CREATE TABLE "KnowledgeSynthesisGroupGrant" (
  "id" TEXT NOT NULL,
  "synthesisId" TEXT NOT NULL,
  "groupAccountId" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,

  CONSTRAINT "KnowledgeSynthesisGroupGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSynthesisGroupGrant_identity_check" CHECK (
    LENGTH(BTRIM("synthesisId")) > 0
    AND LENGTH(BTRIM("groupAccountId")) > 0
    AND LENGTH(BTRIM("createdBy")) > 0
    AND LENGTH(BTRIM("updatedBy")) > 0
  ),
  CONSTRAINT "KnowledgeSynthesisGroupGrant_revoke_check" CHECK (
    ("revokedAt" IS NULL AND "revokedBy" IS NULL)
    OR (
      "revokedAt" IS NOT NULL
      AND "revokedBy" IS NOT NULL
      AND LENGTH(BTRIM("revokedBy")) > 0
      AND "revokedAt" >= "createdAt"
    )
  ),
  CONSTRAINT "KnowledgeSynthesisGroupGrant_timestamp_check" CHECK (
    "updatedAt" >= "createdAt"
  )
);

CREATE UNIQUE INDEX "KnowledgeThreadPromotion_destinationSynthesisId_key"
  ON "KnowledgeThreadPromotion"("destinationSynthesisId");
CREATE UNIQUE INDEX "KnowledgeThreadPromotion_destinationSynthesisVersionId_key"
  ON "KnowledgeThreadPromotion"("destinationSynthesisVersionId");
CREATE INDEX "KnowledgeThreadPromotion_sourceShareId_sourceShareVersion_c_idx"
  ON "KnowledgeThreadPromotion"("sourceShareId", "sourceShareVersion", "createdAt", "id");
CREATE INDEX "KnowledgeThreadPromotion_sourceRoomId_sourceRootMessageId_c_idx"
  ON "KnowledgeThreadPromotion"("sourceRoomId", "sourceRootMessageId", "createdAt", "id");
CREATE INDEX "KnowledgeThreadPromotion_ownerUserId_scope_createdAt_id_idx"
  ON "KnowledgeThreadPromotion"("ownerUserId", "scope", "createdAt", "id");
CREATE INDEX "KnowledgeThreadPromotion_organizationId_scope_createdAt_id_idx"
  ON "KnowledgeThreadPromotion"("organizationId", "scope", "createdAt", "id");
CREATE UNIQUE INDEX "KnowledgeThreadPromotion_id_promoterUserId_key"
  ON "KnowledgeThreadPromotion"("id", "promoterUserId");
CREATE UNIQUE INDEX "KnowledgeThreadPromotion_id_sourceRoomId_sourceRootMessageI_key"
  ON "KnowledgeThreadPromotion"("id", "sourceRoomId", "sourceRootMessageId");

CREATE INDEX "KnowledgeThreadPromotionMessage_sourceMessageId_sourceRoomI_idx"
  ON "KnowledgeThreadPromotionMessage"("sourceMessageId", "sourceRoomId");
CREATE INDEX "KnowledgeThreadPromotionMessage_sourceRootMessageId_sourceR_idx"
  ON "KnowledgeThreadPromotionMessage"("sourceRootMessageId", "sourceRoomId", "ordinal");
CREATE UNIQUE INDEX "KnowledgeThreadPromotionMessage_promotionId_ordinal_key"
  ON "KnowledgeThreadPromotionMessage"("promotionId", "ordinal");
CREATE UNIQUE INDEX "KnowledgeThreadPromotionMessage_promotionId_sourceMessageId_key"
  ON "KnowledgeThreadPromotionMessage"("promotionId", "sourceMessageId");

CREATE UNIQUE INDEX "KnowledgeThreadPromotionRequest_promotionId_key"
  ON "KnowledgeThreadPromotionRequest"("promotionId");
CREATE UNIQUE INDEX "KnowledgeThreadPromotionRequest_promoterUserId_requestKeyHa_key"
  ON "KnowledgeThreadPromotionRequest"("promoterUserId", "requestKeyHash");
CREATE UNIQUE INDEX "KnowledgeThreadPromotionRequest_promotionId_promoterUserId_key"
  ON "KnowledgeThreadPromotionRequest"("promotionId", "promoterUserId");

CREATE INDEX "KnowledgeSynthesisGroupGrant_groupAccountId_revokedAt_synth_idx"
  ON "KnowledgeSynthesisGroupGrant"("groupAccountId", "revokedAt", "synthesisId");
CREATE INDEX "KnowledgeSynthesisGroupGrant_synthesisId_revokedAt_groupAcc_idx"
  ON "KnowledgeSynthesisGroupGrant"("synthesisId", "revokedAt", "groupAccountId");
CREATE UNIQUE INDEX "KnowledgeSynthesisGroupGrant_synthesisId_groupAccountId_key"
  ON "KnowledgeSynthesisGroupGrant"("synthesisId", "groupAccountId");

CREATE UNIQUE INDEX "KnowledgeSynthesisSource_sourceThreadPromotionId_key"
  ON "KnowledgeSynthesisSource"("sourceThreadPromotionId");

ALTER TABLE "KnowledgeThreadPromotion"
  ADD CONSTRAINT "KnowledgeThreadPromotion_sourceShareId_fkey"
  FOREIGN KEY ("sourceShareId") REFERENCES "KnowledgeShare"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "KnowledgeThreadPromotion"
  ADD CONSTRAINT "KnowledgeThreadPromotion_sourceRoomId_fkey"
  FOREIGN KEY ("sourceRoomId") REFERENCES "ChatRoom"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "KnowledgeThreadPromotion"
  ADD CONSTRAINT "KnowledgeThreadPromotion_sourceRootMessageId_sourceRoomId_fkey"
  FOREIGN KEY ("sourceRootMessageId", "sourceRoomId")
  REFERENCES "ChatMessage"("id", "roomId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "KnowledgeThreadPromotion"
  ADD CONSTRAINT "KnowledgeThreadPromotion_destinationSynthesisId_ownerUserI_fkey"
  FOREIGN KEY ("destinationSynthesisId", "ownerUserId")
  REFERENCES "KnowledgeSynthesis"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "KnowledgeThreadPromotion"
  ADD CONSTRAINT "KnowledgeThreadPromotion_destinationSynthesisVersionId_des_fkey"
  FOREIGN KEY (
    "destinationSynthesisVersionId",
    "destinationSynthesisId",
    "destinationSynthesisVersionNumber"
  )
  REFERENCES "KnowledgeSynthesisVersion"("id", "synthesisId", "version")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeThreadPromotionMessage"
  ADD CONSTRAINT "KnowledgeThreadPromotionMessage_promotionId_sourceRoomId_s_fkey"
  FOREIGN KEY ("promotionId", "sourceRoomId", "sourceRootMessageId")
  REFERENCES "KnowledgeThreadPromotion"("id", "sourceRoomId", "sourceRootMessageId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "KnowledgeThreadPromotionMessage"
  ADD CONSTRAINT "KnowledgeThreadPromotionMessage_sourceMessageId_sourceRoom_fkey"
  FOREIGN KEY ("sourceMessageId", "sourceRoomId")
  REFERENCES "ChatMessage"("id", "roomId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "KnowledgeThreadPromotionRequest"
  ADD CONSTRAINT "KnowledgeThreadPromotionRequest_promotionId_promoterUserId_fkey"
  FOREIGN KEY ("promotionId", "promoterUserId")
  REFERENCES "KnowledgeThreadPromotion"("id", "promoterUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeSynthesisGroupGrant"
  ADD CONSTRAINT "KnowledgeSynthesisGroupGrant_synthesisId_fkey"
  FOREIGN KEY ("synthesisId") REFERENCES "KnowledgeSynthesis"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "KnowledgeSynthesisGroupGrant"
  ADD CONSTRAINT "KnowledgeSynthesisGroupGrant_groupAccountId_fkey"
  FOREIGN KEY ("groupAccountId") REFERENCES "GroupAccount"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_sourceThreadPromotionId_fkey"
  FOREIGN KEY ("sourceThreadPromotionId")
  REFERENCES "KnowledgeThreadPromotion"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Keep exactly-one provenance integrity continuously while extending the
-- existing allowlist. The replacement is validated before the old constraint
-- is removed and then takes over the established constraint name.
ALTER TABLE "KnowledgeSynthesisSource"
  ADD CONSTRAINT "KnowledgeSynthesisSource_exactly_one_promotion_check" CHECK (
    NUM_NONNULLS(
      "sourceKnowledgeItemId",
      "sourceSnapshotId",
      "sourceAnnotationId",
      "sourceAnnotationRevisionId",
      "sourceConversationId",
      "sourceConversationTurnId",
      "sourceSynthesisVersionId",
      "sourceThreadPromotionId"
    ) = 1
  ) NOT VALID;
ALTER TABLE "KnowledgeSynthesisSource"
  VALIDATE CONSTRAINT "KnowledgeSynthesisSource_exactly_one_promotion_check";
ALTER TABLE "KnowledgeSynthesisSource"
  DROP CONSTRAINT "KnowledgeSynthesisSource_exactly_one_check";
ALTER TABLE "KnowledgeSynthesisSource"
  RENAME CONSTRAINT "KnowledgeSynthesisSource_exactly_one_promotion_check"
  TO "KnowledgeSynthesisSource_exactly_one_check";

CREATE FUNCTION "erp4_validate_knowledge_thread_promotion"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  share_row "KnowledgeShare"%ROWTYPE;
  root_row "ChatMessage"%ROWTYPE;
  synthesis_row "KnowledgeSynthesis"%ROWTYPE;
  version_row "KnowledgeSynthesisVersion"%ROWTYPE;
BEGIN
  SELECT * INTO share_row
  FROM "KnowledgeShare"
  WHERE "id" = NEW."sourceShareId"
  FOR SHARE;
  IF NOT FOUND
    OR share_row."status" <> 'posted'
    OR share_row."revokedAt" IS NOT NULL
    OR share_row."version" IS DISTINCT FROM NEW."sourceShareVersion"
    OR share_row."contentHash" IS DISTINCT FROM NEW."sourceShareContentHash"
    OR share_row."destinationRoomId" IS DISTINCT FROM NEW."sourceRoomId"
    OR share_row."chatMessageId" IS DISTINCT FROM NEW."sourceRootMessageId"
  THEN
    RAISE EXCEPTION 'knowledge thread promotion requires an exact posted share'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeThreadPromotion_exact_share_check';
  END IF;

  SELECT * INTO root_row
  FROM "ChatMessage"
  WHERE "id" = NEW."sourceRootMessageId"
    AND "roomId" = NEW."sourceRoomId"
  FOR SHARE;
  IF NOT FOUND
    OR root_row."parentMessageId" IS NOT NULL
    OR root_row."threadRootId" IS NOT NULL
    OR root_row."deletedAt" IS NOT NULL
    OR root_row."messageType" <> 'text'
    OR root_row."body" IS DISTINCT FROM 'Knowledge was shared.'
  THEN
    RAISE EXCEPTION 'knowledge thread promotion requires an active share root'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeThreadPromotion_active_root_check';
  END IF;

  SELECT * INTO synthesis_row
  FROM "KnowledgeSynthesis"
  WHERE "id" = NEW."destinationSynthesisId"
    AND "ownerUserId" = NEW."ownerUserId"
  FOR SHARE;
  IF NOT FOUND
    OR synthesis_row."scope" IS DISTINCT FROM NEW."scope"
    OR synthesis_row."organizationId" IS DISTINCT FROM NEW."organizationId"
    OR synthesis_row."currentVersion" <> 1
    OR synthesis_row."deletedAt" IS NOT NULL
  THEN
    RAISE EXCEPTION 'knowledge thread promotion destination is inconsistent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeThreadPromotion_destination_check';
  END IF;

  SELECT * INTO version_row
  FROM "KnowledgeSynthesisVersion"
  WHERE "id" = NEW."destinationSynthesisVersionId"
    AND "synthesisId" = NEW."destinationSynthesisId"
    AND "version" = NEW."destinationSynthesisVersionNumber"
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge thread promotion destination version is missing'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeThreadPromotion_destination_version_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeThreadPromotion_validate_trigger"
BEFORE INSERT ON "KnowledgeThreadPromotion"
FOR EACH ROW
EXECUTE FUNCTION "erp4_validate_knowledge_thread_promotion"();

CREATE FUNCTION "erp4_validate_knowledge_thread_promotion_message"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  promotion_row "KnowledgeThreadPromotion"%ROWTYPE;
  message_row "ChatMessage"%ROWTYPE;
BEGIN
  SELECT * INTO promotion_row
  FROM "KnowledgeThreadPromotion"
  WHERE "id" = NEW."promotionId";
  IF NOT FOUND
    OR promotion_row."sourceRoomId" IS DISTINCT FROM NEW."sourceRoomId"
    OR promotion_row."sourceRootMessageId" IS DISTINCT FROM NEW."sourceRootMessageId"
  THEN
    RAISE EXCEPTION 'selected message does not match promotion thread'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeThreadPromotionMessage_thread_check';
  END IF;

  SELECT * INTO message_row
  FROM "ChatMessage"
  WHERE "id" = NEW."sourceMessageId"
    AND "roomId" = NEW."sourceRoomId"
  FOR SHARE;
  IF NOT FOUND
    OR message_row."parentMessageId" IS DISTINCT FROM NEW."sourceRootMessageId"
    OR message_row."threadRootId" IS DISTINCT FROM NEW."sourceRootMessageId"
    OR message_row."deletedAt" IS NOT NULL
    OR message_row."messageType" <> 'text'
    OR message_row."activitySequence" IS DISTINCT FROM NEW."sourceActivitySequence"
    OR message_row."createdAt" IS DISTINCT FROM NEW."sourceMessageCreatedAt"
    OR message_row."body" IS DISTINCT FROM NEW."content"
  THEN
    RAISE EXCEPTION 'selected reply snapshot is stale or outside the thread'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeThreadPromotionMessage_exact_reply_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeThreadPromotionMessage_validate_trigger"
BEFORE INSERT ON "KnowledgeThreadPromotionMessage"
FOR EACH ROW
EXECUTE FUNCTION "erp4_validate_knowledge_thread_promotion_message"();

CREATE FUNCTION "erp4_validate_knowledge_synthesis_group_grant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  synthesis_row "KnowledgeSynthesis"%ROWTYPE;
BEGIN
  SELECT * INTO synthesis_row
  FROM "KnowledgeSynthesis"
  WHERE "id" = NEW."synthesisId"
  FOR SHARE;
  IF NOT FOUND
    OR synthesis_row."scope" <> 'organization'
    OR synthesis_row."organizationId" IS NULL
    OR synthesis_row."deletedAt" IS NOT NULL
  THEN
    RAISE EXCEPTION 'synthesis group grants require an active organization synthesis'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeSynthesisGroupGrant_scope_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeSynthesisGroupGrant_validate_trigger"
BEFORE INSERT ON "KnowledgeSynthesisGroupGrant"
FOR EACH ROW
EXECUTE FUNCTION "erp4_validate_knowledge_synthesis_group_grant"();

CREATE FUNCTION "erp4_validate_knowledge_thread_promotion_source"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  promotion_row "KnowledgeThreadPromotion"%ROWTYPE;
BEGIN
  IF NEW."sourceThreadPromotionId" IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM "KnowledgeThreadPromotion"
      WHERE "destinationSynthesisVersionId" = NEW."synthesisVersionId"
    ) THEN
      RAISE EXCEPTION 'promotion destination version accepts only its immutable promotion source'
        USING ERRCODE = '23514',
              CONSTRAINT = 'KnowledgeSynthesisSource_thread_promotion_exclusive_check';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO promotion_row
  FROM "KnowledgeThreadPromotion"
  WHERE "id" = NEW."sourceThreadPromotionId";
  IF NOT FOUND
    OR NEW."synthesisVersionId" IS DISTINCT FROM promotion_row."destinationSynthesisVersionId"
    OR NEW."relationType" <> 'primary'
    OR NEW."ordinal" <> 0
  THEN
    RAISE EXCEPTION 'promotion provenance must be the primary source of its exact destination version'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeSynthesisSource_thread_promotion_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeSynthesisSource_thread_promotion_validate_trigger"
BEFORE INSERT OR UPDATE OF
  "synthesisVersionId", "relationType", "ordinal", "sourceThreadPromotionId"
ON "KnowledgeSynthesisSource"
FOR EACH ROW
EXECUTE FUNCTION "erp4_validate_knowledge_thread_promotion_source"();

CREATE FUNCTION "erp4_enforce_knowledge_thread_promotion_complete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  selected_count INTEGER;
  source_count INTEGER;
  destination_source_count INTEGER;
  active_grant_count INTEGER;
  request_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO selected_count
  FROM "KnowledgeThreadPromotionMessage"
  WHERE "promotionId" = NEW."id";

  SELECT COUNT(*) INTO source_count
  FROM "KnowledgeSynthesisSource"
  WHERE "sourceThreadPromotionId" = NEW."id"
    AND "synthesisVersionId" = NEW."destinationSynthesisVersionId";

  SELECT COUNT(*) INTO destination_source_count
  FROM "KnowledgeSynthesisSource"
  WHERE "synthesisVersionId" = NEW."destinationSynthesisVersionId";

  SELECT COUNT(*) INTO active_grant_count
  FROM "KnowledgeSynthesisGroupGrant"
  WHERE "synthesisId" = NEW."destinationSynthesisId"
    AND "revokedAt" IS NULL;

  SELECT COUNT(*) INTO request_count
  FROM "KnowledgeThreadPromotionRequest"
  WHERE "promotionId" = NEW."id"
    AND "promoterUserId" = NEW."promoterUserId";

  IF selected_count <> NEW."selectedMessageCount"
    OR source_count <> 1
    OR destination_source_count <> 1
    OR active_grant_count <> NEW."destinationGrantCount"
    OR request_count <> 1
  THEN
    RAISE EXCEPTION 'knowledge thread promotion aggregate is incomplete'
      USING ERRCODE = '23514',
            CONSTRAINT = 'KnowledgeThreadPromotion_complete_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "KnowledgeThreadPromotion_complete_trigger"
AFTER INSERT ON "KnowledgeThreadPromotion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "erp4_enforce_knowledge_thread_promotion_complete"();

CREATE FUNCTION "erp4_reject_knowledge_thread_promotion_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable knowledge thread promotion history cannot be updated or deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "KnowledgeThreadPromotion_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeThreadPromotion"
FOR EACH ROW
EXECUTE FUNCTION "erp4_reject_knowledge_thread_promotion_mutation"();
CREATE TRIGGER "KnowledgeThreadPromotionMessage_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeThreadPromotionMessage"
FOR EACH ROW
EXECUTE FUNCTION "erp4_reject_knowledge_thread_promotion_mutation"();
CREATE TRIGGER "KnowledgeThreadPromotionRequest_immutable_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeThreadPromotionRequest"
FOR EACH ROW
EXECUTE FUNCTION "erp4_reject_knowledge_thread_promotion_mutation"();

CREATE FUNCTION "erp4_guard_knowledge_synthesis_group_grant_history"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'knowledge synthesis grants must be revoked, not deleted'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."synthesisId" IS DISTINCT FROM OLD."synthesisId"
    OR NEW."groupAccountId" IS DISTINCT FROM OLD."groupAccountId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
    OR (OLD."revokedAt" IS NOT NULL AND (
      NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
      OR NEW."revokedBy" IS DISTINCT FROM OLD."revokedBy"
    ))
  THEN
    RAISE EXCEPTION 'knowledge synthesis grant identity and revocation history are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeSynthesisGroupGrant_history_trigger"
BEFORE UPDATE OR DELETE ON "KnowledgeSynthesisGroupGrant"
FOR EACH ROW
EXECUTE FUNCTION "erp4_guard_knowledge_synthesis_group_grant_history"();

-- Mandatory promotion audit actions use only their aggregate target. This is
-- NOT VALID so unrelated historical audit rows are not scanned by deployment.
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_knowledge_thread_promotion_target_check" CHECK (
    "action" NOT IN (
      'knowledge_thread_promote_previewed',
      'knowledge_thread_promoted',
      'knowledge_thread_promote_duplicate_detected',
      'knowledge_thread_promote_rejected'
    )
    OR (
      "targetTable" = 'knowledge_thread_promotions'
      AND "targetId" IS NOT NULL
    )
  ) NOT VALID;
