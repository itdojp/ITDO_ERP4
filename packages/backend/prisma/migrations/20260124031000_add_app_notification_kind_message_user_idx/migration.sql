-- Add index for daily report missing notification deduplication
CREATE INDEX IF NOT EXISTS "app_notifications_kind_message_user_idx"
  ON "AppNotification" ("kind", "messageId", "userId");
