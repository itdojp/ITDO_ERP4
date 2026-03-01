-- Extend leave settings for paid leave advance policy
ALTER TABLE "LeaveSetting"
  ADD COLUMN "paidLeaveAdvanceMaxMinutes" INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN "paidLeaveAdvanceRequireNextGrantWithinDays" INTEGER NOT NULL DEFAULT 60;

-- Paid leave entitlement profile (one profile per user)
CREATE TABLE "LeaveEntitlementProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "paidLeaveBaseDate" TIMESTAMP(3) NOT NULL,
  "nextGrantDueDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "LeaveEntitlementProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveEntitlementProfile_userId_key"
  ON "LeaveEntitlementProfile"("userId");

CREATE INDEX "LeaveEntitlementProfile_nextGrantDueDate_idx"
  ON "LeaveEntitlementProfile"("nextGrantDueDate");

-- Manual grant ledger
CREATE TABLE "LeaveGrant" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "grantDate" TIMESTAMP(3) NOT NULL,
  "grantedMinutes" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "reasonText" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "LeaveGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeaveGrant_profileId_grantDate_idx"
  ON "LeaveGrant"("profileId", "grantDate");

CREATE INDEX "LeaveGrant_userId_grantDate_idx"
  ON "LeaveGrant"("userId", "grantDate");

CREATE INDEX "LeaveGrant_expiresAt_idx"
  ON "LeaveGrant"("expiresAt");

ALTER TABLE "LeaveGrant"
  ADD CONSTRAINT "LeaveGrant_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "LeaveEntitlementProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
