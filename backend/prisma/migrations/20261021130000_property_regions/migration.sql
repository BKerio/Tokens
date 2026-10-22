-- AlterTable
ALTER TABLE "properties" DROP COLUMN "latitude",
DROP COLUMN "longitude",
DROP COLUMN "map_url",
ADD COLUMN     "constituency_id" INTEGER,
ADD COLUMN     "county_id" INTEGER,
ADD COLUMN     "ward_id" INTEGER;

-- CreateIndex
CREATE INDEX "properties_county_id_idx" ON "properties"("county_id");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_county_id_fkey" FOREIGN KEY ("county_id") REFERENCES "counties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_constituency_id_fkey" FOREIGN KEY ("constituency_id") REFERENCES "constituencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

