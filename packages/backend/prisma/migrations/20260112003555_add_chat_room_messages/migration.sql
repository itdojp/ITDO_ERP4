-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" JSONB,
    "reactions" JSONB,
    "mentions" JSONB,
    "mentionsAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatAckRequest" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "requiredUserIds" JSONB NOT NULL,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ChatAckRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatAck" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatAttachment" (
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

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatReadState" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessage_roomId_createdAt_idx" ON "ChatMessage"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_roomId_userId_mentionsAll_createdAt_idx" ON "ChatMessage"("roomId", "userId", "mentionsAll", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_deletedAt_createdAt_idx" ON "ChatMessage"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatAckRequest_messageId_key" ON "ChatAckRequest"("messageId");

-- CreateIndex
CREATE INDEX "ChatAckRequest_roomId_createdAt_idx" ON "ChatAckRequest"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatAck_userId_idx" ON "ChatAck"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatAck_requestId_userId_key" ON "ChatAck"("requestId", "userId");

-- CreateIndex
CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment"("messageId");

-- CreateIndex
CREATE INDEX "ChatAttachment_createdAt_idx" ON "ChatAttachment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatAttachment_provider_providerKey_key" ON "ChatAttachment"("provider", "providerKey");

-- CreateIndex
CREATE INDEX "ChatReadState_userId_idx" ON "ChatReadState"("userId");

-- CreateIndex
CREATE INDEX "ChatReadState_roomId_idx" ON "ChatReadState"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatReadState_roomId_userId_key" ON "ChatReadState"("roomId", "userId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAckRequest" ADD CONSTRAINT "ChatAckRequest_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAckRequest" ADD CONSTRAINT "ChatAckRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAck" ADD CONSTRAINT "ChatAck_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ChatAckRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReadState" ADD CONSTRAINT "ChatReadState_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed/migrate existing project chat data into room-based tables.
-- project rooms use roomId = projectId.

INSERT INTO "ChatRoom" (
    "id",
    "type",
    "name",
    "isOfficial",
    "projectId",
    "allowExternalUsers",
    "allowExternalIntegrations",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy"
)
SELECT
    p."id",
    'project',
    p."code",
    true,
    p."id",
    false,
    false,
    CURRENT_TIMESTAMP,
    NULL,
    CURRENT_TIMESTAMP,
    NULL
FROM "Project" p
ON CONFLICT DO NOTHING;

INSERT INTO "ChatMessage" (
    "id",
    "roomId",
    "userId",
    "body",
    "tags",
    "reactions",
    "mentions",
    "mentionsAll",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "deletedAt",
    "deletedReason"
)
SELECT
    m."id",
    m."projectId",
    m."userId",
    m."body",
    m."tags",
    m."reactions",
    m."mentions",
    m."mentionsAll",
    m."createdAt",
    m."createdBy",
    m."updatedAt",
    m."updatedBy",
    m."deletedAt",
    m."deletedReason"
FROM "ProjectChatMessage" m
ON CONFLICT DO NOTHING;

INSERT INTO "ChatAckRequest" (
    "id",
    "messageId",
    "roomId",
    "requiredUserIds",
    "dueAt",
    "createdAt",
    "createdBy"
)
SELECT
    r."id",
    r."messageId",
    r."projectId",
    r."requiredUserIds",
    r."dueAt",
    r."createdAt",
    r."createdBy"
FROM "ProjectChatAckRequest" r
ON CONFLICT DO NOTHING;

INSERT INTO "ChatAck" (
    "id",
    "requestId",
    "userId",
    "ackedAt"
)
SELECT
    a."id",
    a."requestId",
    a."userId",
    a."ackedAt"
FROM "ProjectChatAck" a
ON CONFLICT DO NOTHING;

INSERT INTO "ChatAttachment" (
    "id",
    "messageId",
    "provider",
    "providerKey",
    "sha256",
    "sizeBytes",
    "mimeType",
    "originalName",
    "createdAt",
    "createdBy",
    "deletedAt",
    "deletedReason"
)
SELECT
    a."id",
    a."messageId",
    a."provider",
    a."providerKey",
    a."sha256",
    a."sizeBytes",
    a."mimeType",
    a."originalName",
    a."createdAt",
    a."createdBy",
    a."deletedAt",
    a."deletedReason"
FROM "ProjectChatAttachment" a
ON CONFLICT DO NOTHING;

INSERT INTO "ChatReadState" (
    "id",
    "roomId",
    "userId",
    "lastReadAt",
    "createdAt",
    "updatedAt"
)
SELECT
    s."id",
    s."projectId",
    s."userId",
    s."lastReadAt",
    s."createdAt",
    s."updatedAt"
FROM "ProjectChatReadState" s
ON CONFLICT DO NOTHING;
