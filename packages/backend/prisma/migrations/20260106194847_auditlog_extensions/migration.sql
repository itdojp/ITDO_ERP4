-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorGroupId" TEXT,
ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "reasonCode" TEXT,
ADD COLUMN     "reasonText" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "userAgent" TEXT;
