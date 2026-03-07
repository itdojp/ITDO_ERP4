-- CreateTable
CREATE TABLE "ReferenceLink" (
    "id" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "linkKind" TEXT NOT NULL,
    "refKind" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ReferenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceLink_targetKind_targetId_linkKind_refKind_value_key" ON "ReferenceLink"("targetKind", "targetId", "linkKind", "refKind", "value");

-- CreateIndex
CREATE INDEX "ReferenceLink_targetKind_targetId_sortOrder_createdAt_idx" ON "ReferenceLink"("targetKind", "targetId", "sortOrder", "createdAt");

-- CreateIndex
CREATE INDEX "ReferenceLink_targetKind_targetId_linkKind_idx" ON "ReferenceLink"("targetKind", "targetId", "linkKind");
