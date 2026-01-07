-- CreateEnum
CREATE TYPE "ProjectMemberRole" AS ENUM ('leader', 'member');

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN "role" "ProjectMemberRole" NOT NULL DEFAULT 'member';
ALTER TABLE "ProjectMember" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ProjectMember" ADD COLUMN "updatedBy" TEXT;
