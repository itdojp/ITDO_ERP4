-- CreateTable
CREATE TABLE "ChatBreakGlassRequest" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "projectId" TEXT,
    "roomId" TEXT,
    "requesterUserId" TEXT NOT NULL,
    "viewerUserId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "targetFrom" TIMESTAMP(3),
    "targetUntil" TIMESTAMP(3),
    "ttlHours" INTEGER NOT NULL DEFAULT 24,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "approved1By" TEXT,
    "approved1Role" TEXT,
    "approved1At" TIMESTAMP(3),
    "approved2By" TEXT,
    "approved2Role" TEXT,
    "approved2At" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedRole" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "grantedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatBreakGlassRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatBreakGlassAccessLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatBreakGlassAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatBreakGlassRequest_status_createdAt_idx" ON "ChatBreakGlassRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ChatBreakGlassRequest_projectId_createdAt_idx" ON "ChatBreakGlassRequest"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatBreakGlassRequest_viewerUserId_createdAt_idx" ON "ChatBreakGlassRequest"("viewerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatBreakGlassAccessLog_requestId_accessedAt_idx" ON "ChatBreakGlassAccessLog"("requestId", "accessedAt");

-- CreateIndex
CREATE INDEX "ChatBreakGlassAccessLog_actorUserId_accessedAt_idx" ON "ChatBreakGlassAccessLog"("actorUserId", "accessedAt");

-- AddForeignKey
ALTER TABLE "ChatBreakGlassRequest" ADD CONSTRAINT "ChatBreakGlassRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatBreakGlassAccessLog" ADD CONSTRAINT "ChatBreakGlassAccessLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ChatBreakGlassRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

