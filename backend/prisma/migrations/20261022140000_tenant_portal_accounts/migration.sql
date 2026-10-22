-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'TENANT';

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'TENANT_LOGIN';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "portal_access" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "portal_invited_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "landlord_tenants" ADD COLUMN     "portal_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portal_invited_at" TIMESTAMP(3);

