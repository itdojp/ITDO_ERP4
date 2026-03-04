-- Add room-based index for legacy project chat-break-glass route migration.
CREATE INDEX "ChatBreakGlassRequest_roomId_createdAt_idx"
ON "ChatBreakGlassRequest"("roomId", "createdAt");
