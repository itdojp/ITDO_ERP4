-- CreateTable
CREATE TABLE "AppNotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target" TEXT,
    "payload" JSONB,
    "providerMessageId" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "AppNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppNotificationDelivery_status_nextRetryAt_idx" ON "AppNotificationDelivery"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "AppNotificationDelivery_channel_sentAt_idx" ON "AppNotificationDelivery"("channel", "sentAt");

-- CreateIndex
CREATE INDEX "AppNotificationDelivery_notificationId_createdAt_idx" ON "AppNotificationDelivery"("notificationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppNotificationDelivery_notificationId_channel_key" ON "AppNotificationDelivery"("notificationId", "channel");

-- AddForeignKey
ALTER TABLE "AppNotificationDelivery" ADD CONSTRAINT "AppNotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "AppNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
