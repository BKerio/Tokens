import 'dotenv/config';
import { Role } from '../src/generated/prisma/index.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import bcrypt from 'bcrypt';

/**
 * Creates (or resets the password of) a platform operator directly against the database.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts <email> <password> <name> [role]
 *   npx tsx scripts/create-user.ts ops@tokenpap.com 'ChangeMe123!' 'Ops Admin' ADMIN
 *
 * role defaults to ADMIN; valid values: ADMIN | SUPER_ADMIN.
 * Vendors and landlords come with a business profile - create those in the admin panel.
 */
const prisma = createPrismaClient();
const OPERATOR_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

async function main() {
  const [emailArg, password, name, roleArg] = process.argv.slice(2);
  if (!emailArg || !password || !name) {
    console.error('Usage: npx tsx scripts/create-user.ts <email> <password> <name> [role]');
    process.exit(1);
  }

  const role = (roleArg?.toUpperCase() as Role) || Role.ADMIN;
  if (!OPERATOR_ROLES.includes(role)) {
    console.error(`Invalid role "${roleArg}". Valid values: ${OPERATOR_ROLES.join(', ')}`);
    process.exit(1);
  }

  const email = emailArg.toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name, role, status: 'ACTIVE' },
    create: { email, username: email.split('@')[0]!, passwordHash, name, role },
  });

  console.log(`✅ User ready: ${user.email} (${user.role})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
