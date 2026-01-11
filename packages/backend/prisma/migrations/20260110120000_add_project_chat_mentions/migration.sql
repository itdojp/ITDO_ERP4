-- AlterTable
ALTER TABLE "ProjectChatMessage" ADD COLUMN     "mentions" JSONB,
ADD COLUMN     "mentionsAll" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ProjectChatMessage_projectId_userId_mentionsAll_createdAt_idx" ON "ProjectChatMessage"("projectId", "userId", "mentionsAll", "createdAt");

