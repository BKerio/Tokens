import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '../../src/generated/prisma/index.js';

interface RegionFile {
  country: string;
  counties: Record<string, { code: number; capital?: string; constituencies?: Record<string, string[]> }>;
}

/**
 * Seeds Kenya's counties → constituencies → wards from prisma/data/region.json.
 *
 * Ids are assigned the same way as the legacy LocationsSeeder (county = its
 * official code; constituencies and wards numbered 1… in file order), so
 * customers and properties keep pointing at the same rows. Re-running only
 * inserts rows that are missing; existing rows are never changed.
 */
export async function seedRegions(prisma: PrismaClient) {
  const region = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'region.json'), 'utf8')) as RegionFile;

  const counties: { id: number; name: string }[] = [];
  const constituencies: { id: number; name: string; countyId: number }[] = [];
  const wards: { id: number; name: string; countyId: number; constituencyId: number }[] = [];
  let constituencyId = 1;
  let wardId = 1;

  for (const [countyName, county] of Object.entries(region.counties)) {
    const countyId = Number(county.code);
    counties.push({ id: countyId, name: countyName });
    for (const [constituencyName, wardNames] of Object.entries(county.constituencies ?? {})) {
      const cid = constituencyId++;
      constituencies.push({ id: cid, name: constituencyName, countyId });
      for (const ward of Array.isArray(wardNames) ? wardNames : []) {
        wards.push({ id: wardId++, name: ward.toUpperCase(), countyId, constituencyId: cid });
      }
    }
  }

  const added = {
    counties: (await prisma.county.createMany({ data: counties, skipDuplicates: true })).count,
    constituencies: (await prisma.constituency.createMany({ data: constituencies, skipDuplicates: true })).count,
    wards: 0,
  };
  for (let i = 0; i < wards.length; i += 500) {
    added.wards += (await prisma.ward.createMany({ data: wards.slice(i, i + 500), skipDuplicates: true })).count;
  }

  return {
    inFile: { counties: counties.length, constituencies: constituencies.length, wards: wards.length },
    added,
  };
}
