import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/index.js';

/** Query params Prisma understands but node-postgres doesn't. */
const PRISMA_ONLY_PARAMS = ['schema', 'connection_limit', 'pgbouncer', 'pool_timeout', 'connect_timeout'];

/**
 * Splits a Prisma-style DATABASE_URL into a node-postgres connection string
 * and the target schema. The pg driver adapter ignores `?schema=`, so it has
 * to be passed to PrismaPg explicitly.
 */
export function parseDatabaseUrl(raw: string): { connectionString: string; schema?: string; max?: number } {
  const url = new URL(raw);
  const schema = url.searchParams.get('schema') ?? undefined;
  const limit = Number.parseInt(url.searchParams.get('connection_limit') ?? '', 10);
  for (const p of PRISMA_ONLY_PARAMS) url.searchParams.delete(p);
  return { connectionString: url.toString(), schema, max: Number.isNaN(limit) ? undefined : limit };
}

/**
 * Schema-qualified table name for raw SQL. The adapter's `schema` option only
 * applies to model queries, and SET search_path isn't safe behind pgbouncer's
 * transaction pooling - so raw queries name the schema explicitly.
 */
export function rawTable(table: string): string {
  const schema = process.env.DATABASE_URL ? parseDatabaseUrl(process.env.DATABASE_URL).schema : undefined;
  const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
  return schema ? `${quote(schema)}.${quote(table)}` : quote(table);
}

/**
 * Creates a PrismaClient instance using the pg driver adapter.
 * Required for Prisma 7 which no longer reads the DB URL from schema.prisma.
 * The DATABASE_URL must be available in process.env when this is called.
 */
export function createPrismaClient(): PrismaClient {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const { connectionString, schema, max } = parseDatabaseUrl(raw);
  const pool = new Pool({ connectionString, max });
  const adapter = new PrismaPg(pool, schema ? { schema } : undefined);

  return new PrismaClient({ adapter }) as unknown as PrismaClient;
}
