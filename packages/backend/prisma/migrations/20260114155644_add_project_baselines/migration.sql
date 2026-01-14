-- CreateTable
CREATE TABLE "ProjectBaseline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "planHours" DECIMAL(65,30),
    "budgetCost" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,

    CONSTRAINT "ProjectBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBaselineTask" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "planStart" TIMESTAMP(3),
    "planEnd" TIMESTAMP(3),
    "progressPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ProjectBaselineTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBaseline_projectId_createdAt_idx" ON "ProjectBaseline"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectBaseline_projectId_deletedAt_idx" ON "ProjectBaseline"("projectId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBaselineTask_baselineId_taskId_key" ON "ProjectBaselineTask"("baselineId", "taskId");

-- CreateIndex
CREATE INDEX "ProjectBaselineTask_baselineId_idx" ON "ProjectBaselineTask"("baselineId");

-- CreateIndex
CREATE INDEX "ProjectBaselineTask_taskId_idx" ON "ProjectBaselineTask"("taskId");

-- AddForeignKey
ALTER TABLE "ProjectBaseline" ADD CONSTRAINT "ProjectBaseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBaselineTask" ADD CONSTRAINT "ProjectBaselineTask_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "ProjectBaseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBaselineTask" ADD CONSTRAINT "ProjectBaselineTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
