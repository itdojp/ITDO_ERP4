-- System-initialized General Affairs group (used for personal GA chat rooms).
-- Keep the identifier stable and refer to it by id, not displayName.
INSERT INTO "GroupAccount" (
  "id",
  "displayName",
  "active",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
)
VALUES (
  'general_affairs',
  'general_affairs',
  true,
  CURRENT_TIMESTAMP,
  'system',
  CURRENT_TIMESTAMP,
  'system'
)
ON CONFLICT ("id") DO NOTHING;

