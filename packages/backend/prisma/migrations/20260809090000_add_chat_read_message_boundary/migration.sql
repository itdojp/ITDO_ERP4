-- Expand-only, database-assigned arrival order. Existing rows receive stable
-- sequence values and old applications keep writing through the DB default.
ALTER TABLE "ChatMessage"
  ADD COLUMN "activitySequence" BIGSERIAL NOT NULL;

CREATE UNIQUE INDEX "ChatMessage_activitySequence_key"
  ON "ChatMessage"("activitySequence");

CREATE INDEX "ChatMessage_roomId_activitySequence_idx"
  ON "ChatMessage"("roomId", "activitySequence");

-- Read history intentionally has no message FK so it survives logical or
-- operator-managed message removal. Old applications continue to read/write
-- lastReadAt while new applications use the opaque DB sequence internally.
ALTER TABLE "ChatReadState"
  ADD COLUMN "lastReadMessageId" TEXT,
  ADD COLUMN "lastReadActivitySequence" BIGINT;
