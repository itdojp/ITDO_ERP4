-- CreateTable
CREATE TABLE "PeriodLock" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "projectId" TEXT,
    "reason" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeriodLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeriodLock_scope_period_idx" ON "PeriodLock"("scope", "period");

-- CreateIndex
CREATE INDEX "PeriodLock_projectId_idx" ON "PeriodLock"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodLock_period_scope_projectId_key" ON "PeriodLock"("period", "scope", "projectId");

-- AddForeignKey
ALTER TABLE "PeriodLock" ADD CONSTRAINT "PeriodLock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

