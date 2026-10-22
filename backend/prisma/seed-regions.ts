import 'dotenv/config';
import { createPrismaClient } from '../src/lib/prisma.js';
import { seedRegions } from './seeders/regions.js';

/**
 * Seeds only Kenya's counties → constituencies → wards (safe to re-run).
 *
 *   npm run db:seed:regions
 */
const prisma = createPrismaClient();

seedRegions(prisma)
  .then(({ inFile, added }) => {
    console.log(`🗺️  region.json: ${inFile.counties} counties, ${inFile.constituencies} constituencies, ${inFile.wards} wards`);
    console.log(`✅ Added ${added.counties} counties, ${added.constituencies} constituencies, ${added.wards} wards (the rest were already there)`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
