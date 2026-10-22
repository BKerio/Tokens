-- Flatten Property → Zone → Route → Street → Unit to Property → Unit, and add
-- a payment account to each unit. Existing ZONE-type properties become ESTATE.
-- CreateEnum
CREATE TYPE "UnitPaymentMethod" AS ENUM ('MPESA_PAYBILL', 'MPESA_TILL', 'BANK');

-- AlterEnum
BEGIN;
CREATE TYPE "PropertyType_new" AS ENUM ('APARTMENT', 'ESTATE', 'COMMERCIAL', 'MIXED_USE', 'HOSTEL', 'OTHER');
ALTER TABLE "properties" ALTER COLUMN "property_type" TYPE "PropertyType_new" USING ((CASE WHEN "property_type"::text = 'ZONE' THEN 'ESTATE' ELSE "property_type"::text END)::"PropertyType_new");
ALTER TYPE "PropertyType" RENAME TO "PropertyType_old";
ALTER TYPE "PropertyType_new" RENAME TO "PropertyType";
DROP TYPE "PropertyType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "property_zones" DROP CONSTRAINT "property_zones_landlord_id_fkey";

-- DropForeignKey
ALTER TABLE "property_zones" DROP CONSTRAINT "property_zones_property_id_fkey";

-- DropForeignKey
ALTER TABLE "property_routes" DROP CONSTRAINT "property_routes_landlord_id_fkey";

-- DropForeignKey
ALTER TABLE "property_routes" DROP CONSTRAINT "property_routes_property_id_fkey";

-- DropForeignKey
ALTER TABLE "property_routes" DROP CONSTRAINT "property_routes_zone_id_fkey";

-- DropForeignKey
ALTER TABLE "property_streets" DROP CONSTRAINT "property_streets_landlord_id_fkey";

-- DropForeignKey
ALTER TABLE "property_streets" DROP CONSTRAINT "property_streets_property_id_fkey";

-- DropForeignKey
ALTER TABLE "property_streets" DROP CONSTRAINT "property_streets_route_id_fkey";

-- DropForeignKey
ALTER TABLE "property_units" DROP CONSTRAINT "property_units_zone_id_fkey";

-- DropForeignKey
ALTER TABLE "property_units" DROP CONSTRAINT "property_units_route_id_fkey";

-- DropForeignKey
ALTER TABLE "property_units" DROP CONSTRAINT "property_units_street_id_fkey";

-- DropForeignKey
ALTER TABLE "landlord_tenants" DROP CONSTRAINT "landlord_tenants_zone_id_fkey";

-- DropForeignKey
ALTER TABLE "landlord_tenants" DROP CONSTRAINT "landlord_tenants_route_id_fkey";

-- DropForeignKey
ALTER TABLE "landlord_tenants" DROP CONSTRAINT "landlord_tenants_street_id_fkey";

-- AlterTable
ALTER TABLE "property_units" DROP COLUMN "parent_type",
DROP COLUMN "route_id",
DROP COLUMN "street_id",
DROP COLUMN "zone_id",
ADD COLUMN     "payment_account" TEXT,
ADD COLUMN     "payment_account_name" TEXT,
ADD COLUMN     "payment_bank" TEXT,
ADD COLUMN     "payment_method" "UnitPaymentMethod",
ADD COLUMN     "payment_number" TEXT;

-- AlterTable
ALTER TABLE "landlord_tenants" DROP COLUMN "node_type",
DROP COLUMN "route_id",
DROP COLUMN "street_id",
DROP COLUMN "zone_id";

-- DropTable
DROP TABLE "property_zones";

-- DropTable
DROP TABLE "property_routes";

-- DropTable
DROP TABLE "property_streets";

-- DropEnum
DROP TYPE "UnitParentType";

-- DropEnum
DROP TYPE "TenantNodeType";

