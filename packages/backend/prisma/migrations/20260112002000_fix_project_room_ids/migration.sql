-- Normalize project rooms to deterministic ids (roomId = projectId).
-- This simplifies future migrations and keeps project chat APIs stable.

UPDATE "ChatRoom"
SET "id" = "projectId"
WHERE "type" = 'project'
  AND "projectId" IS NOT NULL
  AND "id" <> "projectId";

