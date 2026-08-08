-- Expand-only Chat thread foundation. Existing messages remain roots because both
-- topology columns are nullable and are not backfilled.
CREATE TYPE "ChatMessageType" AS ENUM ('text');

ALTER TABLE "ChatMessage"
  ADD COLUMN "messageType" "ChatMessageType" NOT NULL DEFAULT 'text',
  ADD COLUMN "parentMessageId" TEXT,
  ADD COLUMN "threadRootId" TEXT;

CREATE UNIQUE INDEX "ChatMessage_id_roomId_key"
  ON "ChatMessage"("id", "roomId");

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_thread_shape_check"
  CHECK (
    (
      "parentMessageId" IS NULL
      AND "threadRootId" IS NULL
    )
    OR
    (
      "parentMessageId" IS NOT NULL
      AND "threadRootId" IS NOT NULL
      AND "parentMessageId" = "threadRootId"
      AND "parentMessageId" <> "id"
    )
  ),
  ADD CONSTRAINT "ChatMessage_parentMessageId_roomId_fkey"
  FOREIGN KEY ("parentMessageId", "roomId")
  REFERENCES "ChatMessage"("id", "roomId")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION,
  ADD CONSTRAINT "ChatMessage_threadRootId_roomId_fkey"
  FOREIGN KEY ("threadRootId", "roomId")
  REFERENCES "ChatMessage"("id", "roomId")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

CREATE INDEX "ChatMessage_roomId_parentMessageId_createdAt_id_idx"
  ON "ChatMessage"("roomId", "parentMessageId", "createdAt", "id");
CREATE INDEX "ChatMessage_threadRootId_createdAt_id_idx"
  ON "ChatMessage"("threadRootId", "createdAt", "id");
CREATE INDEX "ChatMessage_threadRootId_deletedAt_createdAt_id_idx"
  ON "ChatMessage"("threadRootId", "deletedAt", "createdAt", "id");

CREATE FUNCTION "erp4_enforce_chat_message_thread_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."roomId" IS DISTINCT FROM OLD."roomId"
      OR NEW."parentMessageId" IS DISTINCT FROM OLD."parentMessageId"
      OR NEW."threadRootId" IS DISTINCT FROM OLD."threadRootId"
      OR NEW."messageType" IS DISTINCT FROM OLD."messageType"
    THEN
      RAISE EXCEPTION 'chat message topology is immutable'
        USING ERRCODE = '23514',
              CONSTRAINT = 'ChatMessage_thread_topology_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."parentMessageId" IS NOT NULL THEN
    PERFORM 1
      FROM "ChatMessage" AS root
     WHERE root."id" = NEW."parentMessageId"
       AND root."roomId" = NEW."roomId"
       AND root."parentMessageId" IS NULL
       AND root."threadRootId" IS NULL
       AND root."deletedAt" IS NULL
       -- Serialize against a concurrent logical-delete UPDATE while still
       -- allowing concurrent reply inserts to share the root lock.
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'chat reply parent must be an active root in the same room'
        USING ERRCODE = '23514',
              CONSTRAINT = 'ChatMessage_reply_parent_active_root';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ChatMessage_thread_integrity_trigger"
BEFORE INSERT OR UPDATE ON "ChatMessage"
FOR EACH ROW
EXECUTE FUNCTION "erp4_enforce_chat_message_thread_integrity"();
