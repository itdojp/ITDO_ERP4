CREATE TABLE "UserNotificationPreference" (
  "userId" TEXT NOT NULL,
  "emailMode" TEXT NOT NULL DEFAULT 'digest',
  "emailDigestIntervalMinutes" INTEGER NOT NULL DEFAULT 10,
  "muteAllUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,

  CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "ChatRoomNotificationSetting" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "notifyAllPosts" BOOLEAN NOT NULL DEFAULT true,
  "notifyMentions" BOOLEAN NOT NULL DEFAULT true,
  "muteUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,

  CONSTRAINT "ChatRoomNotificationSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatRoomNotificationSetting_roomId_userId_key" ON "ChatRoomNotificationSetting"("roomId", "userId");
CREATE INDEX "ChatRoomNotificationSetting_userId_idx" ON "ChatRoomNotificationSetting"("userId");
CREATE INDEX "ChatRoomNotificationSetting_roomId_idx" ON "ChatRoomNotificationSetting"("roomId");

ALTER TABLE "ChatRoomNotificationSetting" ADD CONSTRAINT "ChatRoomNotificationSetting_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
