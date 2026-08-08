-- Expand-only, database-assigned arrival order. Existing rows are backfilled
-- deterministically from the legacy timeline order before the DB sequence is
-- enabled. Keep the ADD COLUMN lock through backfill/default/NOT NULL so an
-- old application cannot insert a null boundary between migration statements.
-- Old applications keep writing through the DB default after commit.
BEGIN;

CREATE SEQUENCE "ChatMessage_activitySequence_seq";

ALTER TABLE "ChatMessage"
  ADD COLUMN "activitySequence" BIGINT;

ALTER SEQUENCE "ChatMessage_activitySequence_seq"
  OWNED BY "ChatMessage"."activitySequence";

WITH ordered_messages AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS sequence_value
  FROM "ChatMessage"
)
UPDATE "ChatMessage" AS message
SET "activitySequence" = ordered_messages.sequence_value
FROM ordered_messages
WHERE message."id" = ordered_messages."id";

ALTER TABLE "ChatMessage"
  ALTER COLUMN "activitySequence"
  SET DEFAULT nextval('"ChatMessage_activitySequence_seq"');

SELECT setval(
  '"ChatMessage_activitySequence_seq"',
  GREATEST(COALESCE(MAX("activitySequence"), 0) + 1, 1),
  false
)
FROM "ChatMessage";

ALTER TABLE "ChatMessage"
  ALTER COLUMN "activitySequence" SET NOT NULL;

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

COMMIT;
