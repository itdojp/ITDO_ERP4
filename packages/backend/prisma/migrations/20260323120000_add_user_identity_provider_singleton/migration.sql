CREATE UNIQUE INDEX "UserIdentity_userAccountId_providerType_issuer_key"
ON "UserIdentity"("userAccountId", "providerType", "issuer");
