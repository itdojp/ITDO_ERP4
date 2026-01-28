-- Add Annotation + AnnotationLog for cross-document notes/refs
CREATE TABLE "Annotation" (
  "id" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "notes" TEXT,
  "externalUrls" JSONB,
  "internalRefs" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Annotation_targetKind_targetId_key" ON "Annotation"("targetKind", "targetId");

CREATE TABLE "AnnotationLog" (
  "id" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "notes" TEXT,
  "externalUrls" JSONB,
  "internalRefs" JSONB,
  "reasonCode" TEXT,
  "reasonText" TEXT,
  "actorRole" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,

  CONSTRAINT "AnnotationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnnotationLog_createdAt_idx" ON "AnnotationLog"("createdAt");
CREATE INDEX "AnnotationLog_targetKind_targetId_createdAt_idx" ON "AnnotationLog"("targetKind", "targetId", "createdAt" DESC);
