-- AlterTable: STK pushes a landlord sends a tenant for rent / deposit.
ALTER TABLE "payments" ADD COLUMN     "lease_purpose" "RentClaimPurpose",
ADD COLUMN     "initiated_by_id" TEXT;
