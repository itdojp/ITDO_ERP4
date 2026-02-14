CREATE TABLE "EvidenceSnapshot" (
  "id" TEXT NOT NULL,
  "approvalInstanceId" TEXT NOT NULL,
  "targetTable" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "sourceAnnotationUpdatedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedBy" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "items" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvidenceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvidenceSnapshot_approvalInstanceId_version_key"
  ON "EvidenceSnapshot"("approvalInstanceId", "version");
CREATE INDEX "EvidenceSnapshot_approvalInstanceId_capturedAt_idx"
  ON "EvidenceSnapshot"("approvalInstanceId", "capturedAt" DESC);

ALTER TABLE "EvidenceSnapshot"
  ADD CONSTRAINT "EvidenceSnapshot_approvalInstanceId_fkey"
  FOREIGN KEY ("approvalInstanceId")
  REFERENCES "ApprovalInstance"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
