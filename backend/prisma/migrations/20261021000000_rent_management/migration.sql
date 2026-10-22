-- Rent management (phase 1): locations, leases, ledger, landlord staff.

-- CreateEnum
CREATE TYPE "LandlordStaffRole" AS ENUM ('MANAGER', 'CARETAKER', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('ACTIVE', 'ENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('RENT_CHARGE', 'OTHER_CHARGE', 'PAYMENT', 'CREDIT', 'DEPOSIT_RECEIVED', 'DEPOSIT_REFUND', 'DEPOSIT_APPLIED', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MPESA', 'CASH', 'BANK', 'CHEQUE', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'LANDLORD_STAFF';

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "location_id" TEXT;

-- AlterTable
ALTER TABLE "property_units" ADD COLUMN     "deposit_amount" DECIMAL(12,2),
ADD COLUMN     "monthly_rent" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "landlord_tenants" ADD COLUMN     "id_number" TEXT;

-- CreateTable
CREATE TABLE "property_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "county" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,

    CONSTRAINT "property_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leases" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rent_amount" DECIMAL(12,2) NOT NULL,
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "billing_frequency" "BillingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "due_day" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "LeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "next_billing_date" DATE,
    "notes" TEXT,
    "terminated_at" TIMESTAMP(3),
    "termination_reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "entry_date" DATE NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "due_date" DATE,
    "method" "PaymentMethod",
    "reference" TEXT,
    "category" TEXT,
    "description" TEXT,
    "billing_key" TEXT,
    "reversal_of_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landlord_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "lease_id" TEXT,
    "tenant_id" TEXT,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landlord_staff" (
    "id" TEXT NOT NULL,
    "staff_role" "LandlordStaffRole" NOT NULL,
    "all_properties" BOOLEAN NOT NULL DEFAULT true,
    "property_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "landlord_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_locations_landlord_id_name_key" ON "property_locations"("landlord_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leases_code_key" ON "leases"("code");

-- CreateIndex
CREATE INDEX "leases_landlord_id_status_idx" ON "leases"("landlord_id", "status");

-- CreateIndex
CREATE INDEX "leases_unit_id_idx" ON "leases"("unit_id");

-- CreateIndex
CREATE INDEX "leases_status_next_billing_date_idx" ON "leases"("status", "next_billing_date");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_billing_key_key" ON "ledger_entries"("billing_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reversal_of_id_key" ON "ledger_entries"("reversal_of_id");

-- CreateIndex
CREATE INDEX "ledger_entries_landlord_id_entry_date_idx" ON "ledger_entries"("landlord_id", "entry_date");

-- CreateIndex
CREATE INDEX "ledger_entries_lease_id_idx" ON "ledger_entries"("lease_id");

-- CreateIndex
CREATE INDEX "ledger_entries_property_id_entry_date_idx" ON "ledger_entries"("property_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "landlord_staff_user_id_key" ON "landlord_staff"("user_id");

-- CreateIndex
CREATE INDEX "landlord_staff_landlord_id_idx" ON "landlord_staff"("landlord_id");

-- CreateIndex
CREATE INDEX "properties_location_id_idx" ON "properties"("location_id");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "property_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_locations" ADD CONSTRAINT "property_locations_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "property_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "landlord_tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "property_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "landlord_tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_staff" ADD CONSTRAINT "landlord_staff_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlord_staff" ADD CONSTRAINT "landlord_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A unit can have at most one ACTIVE lease (enforced even under concurrent requests).
CREATE UNIQUE INDEX "leases_one_active_per_unit" ON "leases"("unit_id") WHERE "status" = 'ACTIVE';

-- The ledger is append-only: corrections are reversal entries, never edits.
CREATE OR REPLACE FUNCTION ledger_entries_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries are append-only; post a reversal instead of updating entry %', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_block_update();
