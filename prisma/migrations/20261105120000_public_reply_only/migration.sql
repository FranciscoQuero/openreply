-- AlterEnum
ALTER TYPE "DmStatus" ADD VALUE 'PUBLIC_REPLY_ONLY';

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "dmEnabled" BOOLEAN NOT NULL DEFAULT true;
