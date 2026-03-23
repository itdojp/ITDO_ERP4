CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "userAccountId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "emailSnapshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastAuthenticatedAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LocalCredential" (
    "id" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordAlgo" TEXT NOT NULL DEFAULT 'argon2id',
    "mfaRequired" BOOLEAN NOT NULL DEFAULT true,
    "mfaSecretRef" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "recoveryCodesHash" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LocalCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIdentity_providerType_issuer_providerSubject_key" ON "UserIdentity"("providerType", "issuer", "providerSubject");
CREATE INDEX "UserIdentity_userAccountId_providerType_status_idx" ON "UserIdentity"("userAccountId", "providerType", "status");
CREATE INDEX "UserIdentity_providerType_issuer_providerSubject_status_idx" ON "UserIdentity"("providerType", "issuer", "providerSubject", "status");
CREATE UNIQUE INDEX "LocalCredential_userIdentityId_key" ON "LocalCredential"("userIdentityId");
CREATE UNIQUE INDEX "LocalCredential_loginId_key" ON "LocalCredential"("loginId");

ALTER TABLE "UserIdentity"
  ADD CONSTRAINT "UserIdentity_userAccountId_fkey"
  FOREIGN KEY ("userAccountId") REFERENCES "UserAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocalCredential"
  ADD CONSTRAINT "LocalCredential_userIdentityId_fkey"
  FOREIGN KEY ("userIdentityId") REFERENCES "UserIdentity"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
