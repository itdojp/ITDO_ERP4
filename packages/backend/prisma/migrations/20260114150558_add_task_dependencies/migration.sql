-- CreateTable
CREATE TABLE "ProjectTaskDependency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromTaskId" TEXT NOT NULL,
    "toTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ProjectTaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTaskDependency_fromTaskId_toTaskId_key" ON "ProjectTaskDependency"("fromTaskId", "toTaskId");

-- CreateIndex
CREATE INDEX "ProjectTaskDependency_projectId_createdAt_idx" ON "ProjectTaskDependency"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectTaskDependency_fromTaskId_idx" ON "ProjectTaskDependency"("fromTaskId");

-- CreateIndex
CREATE INDEX "ProjectTaskDependency_toTaskId_idx" ON "ProjectTaskDependency"("toTaskId");

-- AddForeignKey
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_toTaskId_fkey" FOREIGN KEY ("toTaskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

