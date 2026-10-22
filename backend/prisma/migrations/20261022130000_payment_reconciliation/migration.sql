-- CreateEnum
CREATE TYPE "PaymentResolution" AS ENUM ('RENT_ALLOCATED', 'TOKEN_ISSUED', 'REFUNDED', 'WRITTEN_OFF');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "lease_id" TEXT,
ADD COLUMN     "meter_id" TEXT,
ADD COLUMN     "resolution" "PaymentResolution",
ADD COLUMN     "resolution_note" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "resolved_by_id" TEXT;

-- CreateIndex
CREATE INDEX "payments_meter_id_idx" ON "payments"("meter_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill the meter from the tokens each payment produced...
UPDATE "payments" p SET "meter_id" = t."meter_id"
FROM (SELECT DISTINCT ON ("payment_id") "payment_id", "meter_id" FROM "token_transactions"
      WHERE "payment_id" IS NOT NULL AND "meter_id" IS NOT NULL ORDER BY "payment_id", "created_at") t
WHERE p."id" = t."payment_id" AND p."meter_id" IS NULL;

-- ...or from the account reference ("METER" or "TILL#METER").
UPDATE "payments" p SET "meter_id" = m."id"
FROM "meters" m
WHERE p."meter_id" IS NULL AND p."account_reference" IS NOT NULL
  AND m."meter_number" = CASE WHEN position('#' in p."account_reference") > 0
                              THEN split_part(p."account_reference", '#', 2) ELSE p."account_reference" END;
