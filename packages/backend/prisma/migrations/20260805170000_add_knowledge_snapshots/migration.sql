CREATE TYPE "KnowledgeSnapshotStatus" AS ENUM ('pending', 'ready', 'failed');
CREATE TYPE "KnowledgeSnapshotCaptureMethod" AS ENUM ('text', 'url', 'upload');

CREATE TABLE "KnowledgeSnapshot" (
    "id" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "artifactId" TEXT,
    "version" INTEGER NOT NULL,
    "status" "KnowledgeSnapshotStatus" NOT NULL DEFAULT 'pending',
    "captureMethod" "KnowledgeSnapshotCaptureMethod" NOT NULL,
    "sourceUrl" TEXT,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "extractedText" TEXT,
    "requestKeyHash" TEXT NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "failureCode" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedBy" TEXT NOT NULL,
    "readyAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeSnapshot_version_check" CHECK ("version" >= 1),
    CONSTRAINT "KnowledgeSnapshot_hash_check" CHECK (
      "sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "KnowledgeSnapshot_request_key_hash_check" CHECK (
      "requestKeyHash" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "KnowledgeSnapshot_request_payload_hash_check" CHECK (
      "requestPayloadHash" ~ '^[a-f0-9]{64}$'
    ),
    CONSTRAINT "KnowledgeSnapshot_size_check" CHECK (
      "sizeBytes" IS NULL OR ("sizeBytes" >= 0 AND "sizeBytes" <= 10485760)
    ),
    CONSTRAINT "KnowledgeSnapshot_content_type_check" CHECK (
      "contentType" IS NULL OR "contentType" IN (
        'text/plain', 'text/html', 'application/pdf', 'image/png',
        'image/jpeg', 'image/webp', 'image/gif'
      )
    ),
    CONSTRAINT "KnowledgeSnapshot_text_size_check" CHECK (
      "sizeBytes" IS NULL OR "contentType" NOT IN ('text/plain', 'text/html')
        OR "sizeBytes" <= 1048576
    ),
    CONSTRAINT "KnowledgeSnapshot_state_check" CHECK (
      ("status" = 'pending' AND "artifactId" IS NULL
        AND "failureCode" IS NULL AND "readyAt" IS NULL AND "failedAt" IS NULL)
      OR
      ("status" = 'ready' AND "artifactId" IS NOT NULL AND "sha256" IS NOT NULL
        AND "contentType" IS NOT NULL AND "sizeBytes" IS NOT NULL
        AND "failureCode" IS NULL
        AND "readyAt" IS NOT NULL AND "failedAt" IS NULL)
      OR
      ("status" = 'failed' AND "artifactId" IS NULL AND "failureCode" IS NOT NULL
        AND "readyAt" IS NULL AND "failedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "KnowledgeSnapshot_artifactId_key"
ON "KnowledgeSnapshot"("artifactId");

CREATE UNIQUE INDEX "KnowledgeSnapshot_knowledgeItemId_version_key"
ON "KnowledgeSnapshot"("knowledgeItemId", "version");

CREATE UNIQUE INDEX "KnowledgeSnapshot_knowledgeItemId_requestKeyHash_key"
ON "KnowledgeSnapshot"("knowledgeItemId", "requestKeyHash");

CREATE INDEX "KnowledgeSnapshot_knowledgeItemId_status_createdAt_idx"
ON "KnowledgeSnapshot"("knowledgeItemId", "status", "createdAt");

ALTER TABLE "KnowledgeSnapshot"
ADD CONSTRAINT "KnowledgeSnapshot_knowledgeItemId_fkey"
FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KnowledgeSnapshot"
ADD CONSTRAINT "KnowledgeSnapshot_artifactId_fkey"
FOREIGN KEY ("artifactId") REFERENCES "StorageArtifact"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
