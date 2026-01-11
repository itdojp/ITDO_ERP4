-- CreateTable
CREATE TABLE "ChatRoom" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isOfficial" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT,
    "groupId" TEXT,
    "allowExternalUsers" BOOLEAN NOT NULL DEFAULT false,
    "allowExternalIntegrations" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "ChatRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "ChatRoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoom_type_projectId_key" ON "ChatRoom"("type", "projectId");

-- CreateIndex
CREATE INDEX "ChatRoom_type_createdAt_idx" ON "ChatRoom"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ChatRoom_projectId_createdAt_idx" ON "ChatRoom"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatRoom_deletedAt_idx" ON "ChatRoom"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRoomMember_roomId_userId_key" ON "ChatRoomMember"("roomId", "userId");

-- CreateIndex
CREATE INDEX "ChatRoomMember_userId_idx" ON "ChatRoomMember"("userId");

-- CreateIndex
CREATE INDEX "ChatRoomMember_roomId_idx" ON "ChatRoomMember"("roomId");

-- AddForeignKey
ALTER TABLE "ChatRoom" ADD CONSTRAINT "ChatRoom_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

