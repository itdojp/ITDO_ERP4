-- CreateEnum
CREATE TYPE "LeaveCompGrantStatus" AS ENUM ('active', 'consumed', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "LeaveCompGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "sourceDate" TIMESTAMP(3) NOT NULL,
    "grantDate" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "grantedMinutes" INTEGER NOT NULL,
    "remainingMinutes" INTEGER NOT NULL,
    "status" "LeaveCompGrantStatus" NOT NULL DEFAULT 'active',
    "reasonText" TEXT,
    "sourceTimeEntryIds" JSONB,
    "metadata" JSONB,
    "consumedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LeaveCompGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveCompConsumption" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "consumedMinutes" INTEGER NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "LeaveCompConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveCompGrant_userId_leaveType_status_expiresAt_idx" ON "LeaveCompGrant"("userId", "leaveType", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "LeaveCompGrant_sourceDate_idx" ON "LeaveCompGrant"("sourceDate");

-- CreateIndex
CREATE INDEX "LeaveCompConsumption_leaveRequestId_consumedAt_idx" ON "LeaveCompConsumption"("leaveRequestId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveCompConsumption_grantId_leaveRequestId_key" ON "LeaveCompConsumption"("grantId", "leaveRequestId");

-- AddForeignKey
ALTER TABLE "LeaveCompConsumption" ADD CONSTRAINT "LeaveCompConsumption_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "LeaveCompGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveCompConsumption" ADD CONSTRAINT "LeaveCompConsumption_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
