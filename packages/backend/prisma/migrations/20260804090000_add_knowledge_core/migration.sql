-- CreateEnum
CREATE TYPE "KnowledgeItemScope" AS ENUM ('personal', 'organization');

-- CreateEnum
CREATE TYPE "KnowledgeItemStatus" AS ENUM ('inbox', 'reviewing', 'processed', 'archived');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('x', 'threads', 'news', 'web', 'pdf', 'image', 'manual', 'other');

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "scope" "KnowledgeItemScope" NOT NULL,
    "organizationId" TEXT,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "canonicalUrl" TEXT,
    "title" TEXT,
    "sourceAuthor" TEXT,
    "publishedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saveReason" TEXT,
    "shortNote" TEXT,
    "unresolvedQuestion" TEXT,
    "status" "KnowledgeItemStatus" NOT NULL DEFAULT 'inbox',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "deletedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeItem_scope_organization_check" CHECK (
      ("scope" = 'personal' AND "organizationId" IS NULL)
      OR
      ("scope" = 'organization' AND "organizationId" IS NOT NULL AND LENGTH(BTRIM("organizationId")) > 0)
    ),
    CONSTRAINT "KnowledgeItem_version_check" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "KnowledgeItemGroupGrant" (
    "id" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "groupAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "KnowledgeItemGroupGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeItem_ownerUserId_deletedAt_updatedAt_idx" ON "KnowledgeItem"("ownerUserId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organizationId_scope_deletedAt_updatedAt_idx" ON "KnowledgeItem"("organizationId", "scope", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "KnowledgeItem_scope_status_deletedAt_updatedAt_idx" ON "KnowledgeItem"("scope", "status", "deletedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItemGroupGrant_knowledgeItemId_groupAccountId_key" ON "KnowledgeItemGroupGrant"("knowledgeItemId", "groupAccountId");

-- CreateIndex
CREATE INDEX "KnowledgeItemGroupGrant_groupAccountId_knowledgeItemId_idx" ON "KnowledgeItemGroupGrant"("groupAccountId", "knowledgeItemId");

-- AddForeignKey
ALTER TABLE "KnowledgeItemGroupGrant" ADD CONSTRAINT "KnowledgeItemGroupGrant_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItemGroupGrant" ADD CONSTRAINT "KnowledgeItemGroupGrant_groupAccountId_fkey" FOREIGN KEY ("groupAccountId") REFERENCES "GroupAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
