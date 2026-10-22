-- CreateEnum
CREATE TYPE "UnitOccupancy" AS ENUM ('VACANT', 'OCCUPIED', 'RESERVED', 'MAINTENANCE');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "landlord_id" TEXT,
ADD COLUMN     "unit_id" TEXT;

-- AlterTable
ALTER TABLE "property_units" ADD COLUMN     "occupancy" "UnitOccupancy" NOT NULL DEFAULT 'VACANT',
ADD COLUMN     "occupancy_note" TEXT;

-- CreateIndex
CREATE INDEX "customers_landlord_id_idx" ON "customers"("landlord_id");

-- CreateIndex
CREATE INDEX "customers_unit_id_idx" ON "customers"("unit_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "property_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Units with an active lease are occupied.
UPDATE "property_units" SET "occupancy" = 'OCCUPIED' WHERE "id" IN (SELECT "unit_id" FROM "leases" WHERE "status" = 'ACTIVE');
