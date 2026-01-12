-- AlterTable
ALTER TABLE "ProjectMember" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ProjectChatAckRequest" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requiredUserIds" JSONB NOT NULL,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ProjectChatAckRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectChatAck" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectChatAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChatAckRequest_messageId_key" ON "ProjectChatAckRequest"("messageId");

-- CreateIndex
CREATE INDEX "ProjectChatAckRequest_projectId_createdAt_idx" ON "ProjectChatAckRequest"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectChatAck_userId_idx" ON "ProjectChatAck"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChatAck_requestId_userId_key" ON "ProjectChatAck"("requestId", "userId");

-- AddForeignKey
ALTER TABLE "ProjectChatAckRequest" ADD CONSTRAINT "ProjectChatAckRequest_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ProjectChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChatAckRequest" ADD CONSTRAINT "ProjectChatAckRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChatAck" ADD CONSTRAINT "ProjectChatAck_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProjectChatAckRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
