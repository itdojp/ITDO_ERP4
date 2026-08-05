-- CreateIndex
CREATE INDEX "KnowledgeItem_ownerUserId_deletedAt_updatedAt_id_idx" ON "KnowledgeItem"("ownerUserId", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeItem_organizationId_scope_deletedAt_updatedAt_id_idx" ON "KnowledgeItem"("organizationId", "scope", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeItem_scope_status_deletedAt_updatedAt_id_idx" ON "KnowledgeItem"("scope", "status", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "KnowledgeItemLabel_active_labelId_knowledgeItemId_idx" ON "KnowledgeItemLabel"("labelId", "knowledgeItemId") WHERE "detachedAt" IS NULL;
