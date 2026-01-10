-- CreateTable
CREATE TABLE "ProjectChatReadState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectChatReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectChatReadState_userId_idx" ON "ProjectChatReadState"("userId");

-- CreateIndex
CREATE INDEX "ProjectChatReadState_projectId_idx" ON "ProjectChatReadState"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChatReadState_projectId_userId_key" ON "ProjectChatReadState"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "ProjectChatReadState" ADD CONSTRAINT "ProjectChatReadState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
