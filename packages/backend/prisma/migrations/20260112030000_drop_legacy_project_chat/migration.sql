-- Drop legacy ProjectChat* tables after verifying data exists in Chat* tables.
--
-- This migration is intended as "Step 5" of chat room migration (see docs/requirements/chat-rooms.md).
-- It is safe to run even if ProjectChat* tables do not exist (fresh installs).

DO $$
DECLARE
  missing_messages bigint;
  mismatched_room_ids bigint;
  missing_ack_requests bigint;
  missing_acks bigint;
  missing_attachments bigint;
  missing_read_states bigint;
  mismatched_read_state_room_ids bigint;
BEGIN
  IF to_regclass('"ProjectChatMessage"') IS NOT NULL THEN
    SELECT count(*) INTO missing_messages
    FROM "ProjectChatMessage" legacy
    LEFT JOIN "ChatMessage" chat ON chat.id = legacy.id
    WHERE chat.id IS NULL;

    SELECT count(*) INTO mismatched_room_ids
    FROM "ProjectChatMessage" legacy
    JOIN "ChatMessage" chat ON chat.id = legacy.id
    WHERE chat."roomId" <> legacy."projectId";

    SELECT count(*) INTO missing_ack_requests
    FROM "ProjectChatAckRequest" legacy
    LEFT JOIN "ChatAckRequest" chat ON chat.id = legacy.id
    WHERE chat.id IS NULL;

    SELECT count(*) INTO missing_acks
    FROM "ProjectChatAck" legacy
    LEFT JOIN "ChatAck" chat ON chat.id = legacy.id
    WHERE chat.id IS NULL;

    SELECT count(*) INTO missing_attachments
    FROM "ProjectChatAttachment" legacy
    LEFT JOIN "ChatAttachment" chat ON chat.id = legacy.id
    WHERE chat.id IS NULL;

    SELECT count(*) INTO missing_read_states
    FROM "ProjectChatReadState" legacy
    LEFT JOIN "ChatReadState" chat ON chat.id = legacy.id
    WHERE chat.id IS NULL;

    SELECT count(*) INTO mismatched_read_state_room_ids
    FROM "ProjectChatReadState" legacy
    JOIN "ChatReadState" chat ON chat.id = legacy.id
    WHERE chat."roomId" <> legacy."projectId";

    IF missing_messages > 0
      OR mismatched_room_ids > 0
      OR missing_ack_requests > 0
      OR missing_acks > 0
      OR missing_attachments > 0
      OR missing_read_states > 0
      OR mismatched_read_state_room_ids > 0
    THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'Legacy chat data verification failed: missing_messages=%s mismatched_room_ids=%s missing_ack_requests=%s missing_acks=%s missing_attachments=%s missing_read_states=%s mismatched_read_state_room_ids=%s',
          missing_messages,
          mismatched_room_ids,
          missing_ack_requests,
          missing_acks,
          missing_attachments,
          missing_read_states,
          mismatched_read_state_room_ids
        ),
        HINT = 'Run scripts/checks/chat-migration-step5.sql and confirm Step 4 migration (20260112003555_add_chat_room_messages) was applied before dropping legacy tables.';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "ProjectChatAck";
DROP TABLE IF EXISTS "ProjectChatAckRequest";
DROP TABLE IF EXISTS "ProjectChatAttachment";
DROP TABLE IF EXISTS "ProjectChatReadState";
DROP TABLE IF EXISTS "ProjectChatMessage";

