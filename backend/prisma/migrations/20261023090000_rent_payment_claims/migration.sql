-- CreateEnum
CREATE TYPE "RentClaimPurpose" AS ENUM ('RENT', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "RentClaimStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "rent_payment_claims" (
    "id" TEXT NOT NULL,
    "purpose" "RentClaimPurpose" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" "RentClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ledger_entry_id" TEXT,

    CONSTRAINT "rent_payment_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rent_payment_claims_ledger_entry_id_key" ON "rent_payment_claims"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "rent_payment_claims_landlord_id_status_idx" ON "rent_payment_claims"("landlord_id", "status");

-- CreateIndex
CREATE INDEX "rent_payment_claims_tenant_id_idx" ON "rent_payment_claims"("tenant_id");

-- A receipt can only be claimed once per landlord unless the earlier claim was rejected.
CREATE UNIQUE INDEX "rent_payment_claims_landlord_reference_live_key"
    ON "rent_payment_claims"("landlord_id", upper("reference"))
    WHERE "reference" IS NOT NULL AND "status" <> 'REJECTED';

-- AddForeignKey
ALTER TABLE "rent_payment_claims" ADD CONSTRAINT "rent_payment_claims_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payment_claims" ADD CONSTRAINT "rent_payment_claims_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payment_claims" ADD CONSTRAINT "rent_payment_claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "landlord_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payment_claims" ADD CONSTRAINT "rent_payment_claims_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
