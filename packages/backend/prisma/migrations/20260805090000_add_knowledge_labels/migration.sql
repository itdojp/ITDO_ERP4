-- CreateEnum
CREATE TYPE "KnowledgeLabelAssignmentSource" AS ENUM ('manual', 'import', 'ai_suggestion');

-- CreateEnum
CREATE TYPE "KnowledgeLabelGrantCapability" AS ENUM ('use', 'manage');
-- Application authorization treats manage as implying use.

-- CreateEnum
CREATE TYPE "KnowledgeSavedViewLabelOperator" AS ENUM ('any', 'all', 'not');

-- CreateTable
CREATE TABLE "KnowledgeLabel" (
    "id" TEXT NOT NULL,
    "scope" "KnowledgeItemScope" NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "KnowledgeLabel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeLabel_scope_ownership_check" CHECK (
      (
        "scope" = 'personal'
        AND "ownerUserId" IS NOT NULL
        AND LENGTH(BTRIM("ownerUserId")) > 0
        AND "ownerUserId" = BTRIM("ownerUserId")
        AND "organizationId" IS NULL
      )
      OR
      (
        "scope" = 'organization'
        AND "ownerUserId" IS NOT NULL
        AND LENGTH(BTRIM("ownerUserId")) > 0
        AND "ownerUserId" = BTRIM("ownerUserId")
        AND "organizationId" IS NOT NULL
        AND LENGTH(BTRIM("organizationId")) > 0
        AND "organizationId" = BTRIM("organizationId")
      )
    ),
    CONSTRAINT "KnowledgeLabel_displayName_normalized_check" CHECK (
      LENGTH(BTRIM("displayName")) > 0
      AND "displayName" = BTRIM("displayName")
    ),
    CONSTRAINT "KnowledgeLabel_slug_normalized_check" CHECK (
      LENGTH(BTRIM("slug")) > 0 AND "slug" = LOWER(BTRIM("slug"))
    ),
    CONSTRAINT "KnowledgeLabel_parent_not_self_check" CHECK (
      "parentId" IS NULL OR "parentId" <> "id"
    ),
    CONSTRAINT "KnowledgeLabel_version_check" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "KnowledgeLabelAlias" (
    "id" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "KnowledgeLabelAlias_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeLabelAlias_alias_normalized_check" CHECK (
      LENGTH(BTRIM("alias")) > 0
      AND "alias" = BTRIM("alias")
    ),
    CONSTRAINT "KnowledgeLabelAlias_normalizedAlias_nonblank_check" CHECK (
      LENGTH(BTRIM("normalizedAlias")) > 0
      AND "normalizedAlias" = BTRIM("normalizedAlias")
    )
);

-- CreateTable
-- Maximum hierarchy depth (8) is enforced by application runtime. The database
-- stores closure rows and enforces only non-negative/self/non-self semantics.
CREATE TABLE "KnowledgeLabelPath" (
    "id" TEXT NOT NULL,
    "ancestorId" TEXT NOT NULL,
    "descendantId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "KnowledgeLabelPath_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeLabelPath_depth_check" CHECK ("depth" >= 0),
    CONSTRAINT "KnowledgeLabelPath_self_depth_check" CHECK (
      ("ancestorId" = "descendantId" AND "depth" = 0)
      OR
      ("ancestorId" <> "descendantId" AND "depth" > 0)
    )
);

-- CreateTable
CREATE TABLE "KnowledgeItemLabel" (
    "id" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "assignmentSource" "KnowledgeLabelAssignmentSource" NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "confidenceBasisPoints" INTEGER,
    "detachedAt" TIMESTAMP(3),
    "detachedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItemLabel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeItemLabel_assignedBy_nonblank_check" CHECK (
      LENGTH(BTRIM("assignedBy")) > 0 AND "assignedBy" = BTRIM("assignedBy")
    ),
    CONSTRAINT "KnowledgeItemLabel_confidenceBasisPoints_check" CHECK (
      "confidenceBasisPoints" IS NULL
      OR
      (
        "assignmentSource" = 'ai_suggestion'
        AND "confidenceBasisPoints" BETWEEN 0 AND 10000
      )
    ),
    CONSTRAINT "KnowledgeItemLabel_detached_state_check" CHECK (
      (
        "detachedAt" IS NULL
        AND "detachedBy" IS NULL
      )
      OR
      (
        "detachedAt" IS NOT NULL
        AND "detachedBy" IS NOT NULL
        AND LENGTH(BTRIM("detachedBy")) > 0
        AND "detachedBy" = BTRIM("detachedBy")
      )
    )
);

-- CreateTable
CREATE TABLE "KnowledgeLabelGroupGrant" (
    "id" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "groupAccountId" TEXT NOT NULL,
    "capability" "KnowledgeLabelGrantCapability" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "KnowledgeLabelGroupGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSavedView" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "KnowledgeSourceType",
    "status" "KnowledgeItemStatus",
    "scope" "KnowledgeItemScope",
    "publishedFrom" TIMESTAMP(3),
    "publishedTo" TIMESTAMP(3),
    "capturedFrom" TIMESTAMP(3),
    "capturedTo" TIMESTAMP(3),
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "KnowledgeSavedView_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KnowledgeSavedView_ownerUserId_nonblank_check" CHECK (
      LENGTH(BTRIM("ownerUserId")) > 0
      AND "ownerUserId" = BTRIM("ownerUserId")
    ),
    CONSTRAINT "KnowledgeSavedView_name_normalized_check" CHECK (
      LENGTH(BTRIM("name")) > 0 AND "name" = BTRIM("name")
    ),
    CONSTRAINT "KnowledgeSavedView_schemaVersion_check" CHECK ("schemaVersion" >= 1),
    CONSTRAINT "KnowledgeSavedView_version_check" CHECK ("version" >= 1),
    CONSTRAINT "KnowledgeSavedView_published_range_check" CHECK (
      "publishedFrom" IS NULL
      OR "publishedTo" IS NULL
      OR "publishedFrom" <= "publishedTo"
    ),
    CONSTRAINT "KnowledgeSavedView_captured_range_check" CHECK (
      "capturedFrom" IS NULL
      OR "capturedTo" IS NULL
      OR "capturedFrom" <= "capturedTo"
    )
);

-- CreateTable
CREATE TABLE "KnowledgeSavedViewLabelFilter" (
    "id" TEXT NOT NULL,
    "savedViewId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "operator" "KnowledgeSavedViewLabelOperator" NOT NULL,
    "includeDescendants" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSavedViewLabelFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeLabel_ownerUserId_deletedAt_updatedAt_id_idx" ON "KnowledgeLabel"("ownerUserId", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeLabel_organizationId_deletedAt_updatedAt_id_idx" ON "KnowledgeLabel"("organizationId", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeLabel_parentId_deletedAt_updatedAt_id_idx" ON "KnowledgeLabel"("parentId", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLabel_active_personal_ownerUserId_slug_key" ON "KnowledgeLabel"("ownerUserId", "slug") WHERE "deletedAt" IS NULL AND "scope" = 'personal';

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLabel_active_organization_organizationId_slug_key" ON "KnowledgeLabel"("organizationId", "slug") WHERE "deletedAt" IS NULL AND "scope" = 'organization';

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLabelAlias_labelId_normalizedAlias_key" ON "KnowledgeLabelAlias"("labelId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "KnowledgeLabelAlias_normalizedAlias_updatedAt_id_idx" ON "KnowledgeLabelAlias"("normalizedAlias", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLabelPath_ancestorId_descendantId_key" ON "KnowledgeLabelPath"("ancestorId", "descendantId");

-- CreateIndex
CREATE INDEX "KnowledgeLabelPath_descendantId_depth_ancestorId_idx" ON "KnowledgeLabelPath"("descendantId", "depth", "ancestorId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItemLabel_active_knowledgeItemId_labelId_key" ON "KnowledgeItemLabel"("knowledgeItemId", "labelId") WHERE "detachedAt" IS NULL;

-- CreateIndex
CREATE INDEX "KnowledgeItemLabel_knowledgeItemId_detachedAt_updatedAt_id_idx" ON "KnowledgeItemLabel"("knowledgeItemId", "detachedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeItemLabel_labelId_detachedAt_updatedAt_id_idx" ON "KnowledgeItemLabel"("labelId", "detachedAt", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLabelGroupGrant_labelId_groupAccountId_key" ON "KnowledgeLabelGroupGrant"("labelId", "groupAccountId");

-- CreateIndex
CREATE INDEX "KnowledgeLabelGroupGrant_groupAccountId_active_updatedAt_id_idx" ON "KnowledgeLabelGroupGrant"("groupAccountId", "active", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeSavedView_ownerUserId_deletedAt_updatedAt_id_idx" ON "KnowledgeSavedView"("ownerUserId", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSavedViewLabelFilter_savedViewId_labelId_key" ON "KnowledgeSavedViewLabelFilter"("savedViewId", "labelId");

-- CreateIndex
CREATE INDEX "KnowledgeSavedViewLabelFilter_labelId_operator_savedViewId_idx" ON "KnowledgeSavedViewLabelFilter"("labelId", "operator", "savedViewId");

-- AddForeignKey
ALTER TABLE "KnowledgeLabel" ADD CONSTRAINT "KnowledgeLabel_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLabelAlias" ADD CONSTRAINT "KnowledgeLabelAlias_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "KnowledgeLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLabelPath" ADD CONSTRAINT "KnowledgeLabelPath_ancestorId_fkey" FOREIGN KEY ("ancestorId") REFERENCES "KnowledgeLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLabelPath" ADD CONSTRAINT "KnowledgeLabelPath_descendantId_fkey" FOREIGN KEY ("descendantId") REFERENCES "KnowledgeLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItemLabel" ADD CONSTRAINT "KnowledgeItemLabel_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItemLabel" ADD CONSTRAINT "KnowledgeItemLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "KnowledgeLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLabelGroupGrant" ADD CONSTRAINT "KnowledgeLabelGroupGrant_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "KnowledgeLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLabelGroupGrant" ADD CONSTRAINT "KnowledgeLabelGroupGrant_groupAccountId_fkey" FOREIGN KEY ("groupAccountId") REFERENCES "GroupAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSavedViewLabelFilter" ADD CONSTRAINT "KnowledgeSavedViewLabelFilter_savedViewId_fkey" FOREIGN KEY ("savedViewId") REFERENCES "KnowledgeSavedView"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSavedViewLabelFilter" ADD CONSTRAINT "KnowledgeSavedViewLabelFilter_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "KnowledgeLabel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
