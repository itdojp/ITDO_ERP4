-- Add AnnotationSetting for annotation limits (notes/external URLs)
CREATE TABLE "AnnotationSetting" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "maxExternalUrlCount" INTEGER NOT NULL DEFAULT 20,
  "maxExternalUrlLength" INTEGER NOT NULL DEFAULT 2048,
  "maxExternalUrlTotalLength" INTEGER NOT NULL DEFAULT 16384,
  "maxNotesLength" INTEGER NOT NULL DEFAULT 20000,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "AnnotationSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AnnotationSetting" (
  "id",
  "maxExternalUrlCount",
  "maxExternalUrlLength",
  "maxExternalUrlTotalLength",
  "maxNotesLength",
  "createdAt",
  "updatedAt"
)
VALUES ('default', 20, 2048, 16384, 20000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

