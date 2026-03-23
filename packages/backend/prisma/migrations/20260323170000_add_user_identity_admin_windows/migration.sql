ALTER TABLE "UserIdentity"
  ADD COLUMN "effectiveUntil" TIMESTAMP(3),
  ADD COLUMN "rollbackWindowUntil" TIMESTAMP(3),
  ADD COLUMN "note" TEXT;

ALTER TABLE "LocalCredential"
  ADD COLUMN "mustRotatePassword" BOOLEAN NOT NULL DEFAULT false;
