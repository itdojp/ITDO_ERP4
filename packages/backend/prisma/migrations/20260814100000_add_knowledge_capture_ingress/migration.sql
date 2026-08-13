-- Expand-only browser/PWA capture ingress foundation.  Existing Knowledge
-- tables and rows are intentionally left unchanged for application rollback.
CREATE TYPE "KnowledgeCaptureChannel" AS ENUM (
  'pwa_share_target',
  'browser_extension'
);

CREATE TYPE "KnowledgeCaptureStatus" AS ENUM ('pending', 'ready', 'failed');

CREATE TYPE "KnowledgeCaptureFailureCode" AS ENUM (
  'snapshot_storage_failed'
);

CREATE TABLE "KnowledgeCaptureRequest" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "requestKeyHash" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "channel" "KnowledgeCaptureChannel" NOT NULL,
  "scope" "KnowledgeItemScope" NOT NULL,
  "organizationId" TEXT,
  "knowledgeItemId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "status" "KnowledgeCaptureStatus" NOT NULL DEFAULT 'pending',
  "failureCode" "KnowledgeCaptureFailureCode",
  "selectedFieldCount" INTEGER NOT NULL,
  "payloadByteCount" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "committedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KnowledgeCaptureRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeCaptureRequest_scope_check" CHECK (
    ("scope" = 'personal' AND "organizationId" IS NULL) OR
    ("scope" = 'organization' AND "organizationId" IS NOT NULL)
  ),
  CONSTRAINT "KnowledgeCaptureRequest_hash_check" CHECK (
    "requestKeyHash" ~ '^[0-9a-f]{64}$' AND
    "payloadHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "KnowledgeCaptureRequest_counts_check" CHECK (
    "selectedFieldCount" BETWEEN 1 AND 6 AND
    "payloadByteCount" BETWEEN 1 AND 131072 AND
    "snapshotVersion" > 0 AND
    "version" > 0
  ),
  CONSTRAINT "KnowledgeCaptureRequest_state_check" CHECK (
    ("status" = 'pending' AND "failureCode" IS NULL AND "committedAt" IS NULL AND "failedAt" IS NULL) OR
    ("status" = 'ready' AND "failureCode" IS NULL AND "committedAt" IS NOT NULL AND "failedAt" IS NULL) OR
    ("status" = 'failed' AND "failureCode" IS NOT NULL AND "committedAt" IS NULL AND "failedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "KnowledgeCaptureRequest_snapshotId_key"
  ON "KnowledgeCaptureRequest"("snapshotId");
CREATE UNIQUE INDEX "KnowledgeCaptureRequest_ownerUserId_requestKeyHash_key"
  ON "KnowledgeCaptureRequest"("ownerUserId", "requestKeyHash");
CREATE UNIQUE INDEX "KnowledgeCaptureRequest_snapshotId_knowledgeItemId_snapshot_key"
  ON "KnowledgeCaptureRequest"("snapshotId", "knowledgeItemId", "snapshotVersion");
CREATE INDEX "KnowledgeCaptureRequest_ownerUserId_payloadHash_createdAt_idx"
  ON "KnowledgeCaptureRequest"("ownerUserId", "payloadHash", "createdAt");
CREATE INDEX "KnowledgeCaptureRequest_ownerUserId_status_createdAt_idx"
  ON "KnowledgeCaptureRequest"("ownerUserId", "status", "createdAt");

ALTER TABLE "KnowledgeCaptureRequest"
  ADD CONSTRAINT "KnowledgeCaptureRequest_knowledgeItemId_ownerUserId_fkey"
  FOREIGN KEY ("knowledgeItemId", "ownerUserId")
  REFERENCES "KnowledgeItem"("id", "ownerUserId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "KnowledgeCaptureRequest"
  ADD CONSTRAINT "KnowledgeCaptureRequest_snapshotId_knowledgeItemId_snapsho_fkey"
  FOREIGN KEY ("snapshotId", "knowledgeItemId", "snapshotVersion")
  REFERENCES "KnowledgeSnapshot"("id", "knowledgeItemId", "version")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "erp4_guard_knowledge_capture_request"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'knowledge capture history is immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId"
     OR NEW."requestKeyHash" IS DISTINCT FROM OLD."requestKeyHash"
     OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash"
     OR NEW."channel" IS DISTINCT FROM OLD."channel"
     OR NEW."scope" IS DISTINCT FROM OLD."scope"
     OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."knowledgeItemId" IS DISTINCT FROM OLD."knowledgeItemId"
     OR NEW."snapshotId" IS DISTINCT FROM OLD."snapshotId"
     OR NEW."snapshotVersion" IS DISTINCT FROM OLD."snapshotVersion"
     OR NEW."selectedFieldCount" IS DISTINCT FROM OLD."selectedFieldCount"
     OR NEW."payloadByteCount" IS DISTINCT FROM OLD."payloadByteCount"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'knowledge capture identity is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'pending'
     OR NEW."status" NOT IN ('ready', 'failed')
     OR NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'invalid knowledge capture transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "KnowledgeCaptureRequest_guard_update"
BEFORE UPDATE ON "KnowledgeCaptureRequest"
FOR EACH ROW EXECUTE FUNCTION "erp4_guard_knowledge_capture_request"();

CREATE TRIGGER "KnowledgeCaptureRequest_guard_delete"
BEFORE DELETE ON "KnowledgeCaptureRequest"
FOR EACH ROW EXECUTE FUNCTION "erp4_guard_knowledge_capture_request"();

-- Bind the mandatory capture audit vocabulary to the capture aggregate.  The
-- constraint is NOT VALID so this expand-only migration does not scan or
-- rewrite historical audit rows, while PostgreSQL still checks every new row.
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_knowledge_capture_target_check" CHECK (
    "action" NOT IN (
      'knowledge_capture_previewed',
      'knowledge_capture_committed',
      'knowledge_capture_duplicate_detected',
      'knowledge_capture_pending',
      'knowledge_capture_reconciled',
      'knowledge_capture_rejected',
      'knowledge_capture_discarded'
    )
    OR (
      "targetTable" = 'knowledge_capture_requests'
      AND "targetId" IS NOT NULL
    )
  ) NOT VALID;
