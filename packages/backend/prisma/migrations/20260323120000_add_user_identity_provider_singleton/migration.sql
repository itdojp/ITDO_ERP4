CREATE UNIQUE INDEX "UserIdentity_userAccountId_providerType_key"
ON "UserIdentity"("userAccountId", "providerType");
