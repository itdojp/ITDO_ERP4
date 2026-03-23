-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "userAccountId" TEXT NOT NULL,
    "userIdentityId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "sourceIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthOidcFlow" (
    "id" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "flowTokenHash" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "returnTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthOidcFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_sessionTokenHash_key" ON "AuthSession"("sessionTokenHash");
CREATE INDEX "AuthSession_userAccountId_revokedAt_idx" ON "AuthSession"("userAccountId", "revokedAt");
CREATE INDEX "AuthSession_userIdentityId_revokedAt_idx" ON "AuthSession"("userIdentityId", "revokedAt");
CREATE INDEX "AuthSession_providerType_issuer_providerSubject_revokedAt_idx" ON "AuthSession"("providerType", "issuer", "providerSubject", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthOidcFlow_flowTokenHash_key" ON "AuthOidcFlow"("flowTokenHash");
CREATE UNIQUE INDEX "AuthOidcFlow_state_key" ON "AuthOidcFlow"("state");
CREATE INDEX "AuthOidcFlow_providerType_expiresAt_idx" ON "AuthOidcFlow"("providerType", "expiresAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userIdentityId_fkey" FOREIGN KEY ("userIdentityId") REFERENCES "UserIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
