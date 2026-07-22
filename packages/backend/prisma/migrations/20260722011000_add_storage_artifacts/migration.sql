CREATE TABLE "StorageArtifact" (
    "id" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StorageArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorageArtifact_context_provider_providerKey_key"
ON "StorageArtifact"("context", "provider", "providerKey");

CREATE UNIQUE INDEX "StorageArtifact_context_provider_idempotencyKey_key"
ON "StorageArtifact"("context", "provider", "idempotencyKey");

CREATE INDEX "StorageArtifact_context_status_createdAt_idx"
ON "StorageArtifact"("context", "status", "createdAt");

CREATE INDEX "StorageArtifact_ownerType_ownerId_createdAt_idx"
ON "StorageArtifact"("ownerType", "ownerId", "createdAt");
