/// <reference types="node" />
import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrate / db push) uses the direct session connection when one is
// configured - DDL doesn't work through pgbouncer's transaction pooler.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
