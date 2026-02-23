CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "source" TEXT,
    "principalUserId" TEXT,
    "actorUserId" TEXT,
    "scopes" JSONB,
    "method" TEXT,
    "path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorCode" TEXT,
    "input" JSONB,
    "output" JSONB,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionRequest" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "decisionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT,
    "reasonText" TEXT,
    "targetTable" TEXT,
    "targetId" TEXT,
    "requestedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentRun_requestId_idx" ON "AgentRun"("requestId");
CREATE INDEX "AgentRun_principalUserId_startedAt_idx" ON "AgentRun"("principalUserId", "startedAt");
CREATE INDEX "AgentRun_actorUserId_startedAt_idx" ON "AgentRun"("actorUserId", "startedAt");
CREATE INDEX "AgentRun_status_startedAt_idx" ON "AgentRun"("status", "startedAt");

CREATE INDEX "AgentStep_runId_stepOrder_idx" ON "AgentStep"("runId", "stepOrder");
CREATE INDEX "AgentStep_runId_startedAt_idx" ON "AgentStep"("runId", "startedAt");

CREATE INDEX "DecisionRequest_runId_requestedAt_idx" ON "DecisionRequest"("runId", "requestedAt");
CREATE INDEX "DecisionRequest_stepId_requestedAt_idx" ON "DecisionRequest"("stepId", "requestedAt");
CREATE INDEX "DecisionRequest_status_requestedAt_idx" ON "DecisionRequest"("status", "requestedAt");
CREATE INDEX "DecisionRequest_targetTable_targetId_idx" ON "DecisionRequest"("targetTable", "targetId");

ALTER TABLE "AgentStep"
    ADD CONSTRAINT "AgentStep_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "AgentRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DecisionRequest"
    ADD CONSTRAINT "DecisionRequest_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "AgentRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DecisionRequest"
    ADD CONSTRAINT "DecisionRequest_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "AgentStep"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
