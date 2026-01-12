-- CreateTable
CREATE TABLE "ReassignmentLog" (
    "id" TEXT NOT NULL,
    "targetTable" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "fromProjectId" TEXT,
    "toProjectId" TEXT,
    "fromTaskId" TEXT,
    "toTaskId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ReassignmentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReassignmentLog_targetTable_targetId_idx" ON "ReassignmentLog"("targetTable", "targetId");

-- CreateIndex
CREATE INDEX "ReassignmentLog_fromProjectId_idx" ON "ReassignmentLog"("fromProjectId");

-- CreateIndex
CREATE INDEX "ReassignmentLog_toProjectId_idx" ON "ReassignmentLog"("toProjectId");
