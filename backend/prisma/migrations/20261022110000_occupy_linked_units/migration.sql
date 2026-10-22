-- Units with a linked tenant or customer are occupied, not vacant.
UPDATE "property_units" SET "occupancy" = 'OCCUPIED'
WHERE "occupancy" = 'VACANT'
  AND ("id" IN (SELECT "unit_id" FROM "landlord_tenants" WHERE "unit_id" IS NOT NULL)
    OR "id" IN (SELECT "unit_id" FROM "customers" WHERE "unit_id" IS NOT NULL));
