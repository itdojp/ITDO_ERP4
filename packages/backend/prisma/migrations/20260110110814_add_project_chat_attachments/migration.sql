-- CreateTable
CREATE TABLE "ProjectChatAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "sha256" TEXT,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "originalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "ProjectChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectChatAttachment_messageId_idx" ON "ProjectChatAttachment"("messageId");

-- CreateIndex
CREATE INDEX "ProjectChatAttachment_createdAt_idx" ON "ProjectChatAttachment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChatAttachment_provider_providerKey_key" ON "ProjectChatAttachment"("provider", "providerKey");

-- AddForeignKey
ALTER TABLE "ProjectChatAttachment" ADD CONSTRAINT "ProjectChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProjectChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
