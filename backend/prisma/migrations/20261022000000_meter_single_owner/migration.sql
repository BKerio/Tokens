-- A meter belongs to a vendor or a landlord, never both.
ALTER TABLE "meters" ADD CONSTRAINT "meters_single_owner" CHECK ("vendor_id" IS NULL OR "landlord_id" IS NULL);
