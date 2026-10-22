import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { ConfigValueType, Role } from '../src/generated/prisma/index.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { encryptString } from '../src/shared/utils/crypto.js';
import { seedRegions } from './seeders/regions.js';

/**
 * Idempotent seed: a super admin, the global SMS / M-Pesa config keys, STS
 * vending defaults and Kenya's counties → constituencies → wards. Existing
 * rows are never overwritten, so it's safe to re-run (and to run after
 * scripts/migrate-from-mongo.ts).
 *
 *   npm run db:seed
 *   SEED_ADMIN_EMAIL=me@x.com SEED_ADMIN_PASSWORD='S3cret!pass' npm run db:seed
 */
const prisma = createPrismaClient();
const encryptionKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET!;

type ConfigSeed = { key: string; value: string; type?: ConfigValueType; category: string; description: string; encrypted?: boolean };

const SYSTEM_CONFIGS: ConfigSeed[] = [
  { key: 'sms_provider', value: 'advanta', category: 'sms', description: 'SMS Provider name (advanta, fornax, ...)' },
  { key: 'sms_api_url', value: 'https://quicksms.advantasms.com/api/services/sendsms/', category: 'sms', description: 'SMS API endpoint URL' },
  { key: 'sms_api_key', value: 'CHANGE_ME_SMS_API_KEY', category: 'sms', description: 'SMS API Key', encrypted: true },
  { key: 'sms_partner_id', value: '', category: 'sms', description: 'SMS Partner ID' },
  { key: 'sms_shortcode', value: '', category: 'sms', description: 'SMS Shortcode / Sender ID' },
  { key: 'sms_enabled', value: 'true', type: ConfigValueType.BOOLEAN, category: 'sms', description: 'Enable or disable SMS service' },
  { key: 'mpesa_consumer_key', value: 'CHANGE_ME_CONSUMER_KEY', category: 'mpesa', description: 'M-Pesa Consumer Key', encrypted: true },
  { key: 'mpesa_consumer_secret', value: 'CHANGE_ME_CONSUMER_SECRET', category: 'mpesa', description: 'M-Pesa Consumer Secret', encrypted: true },
  { key: 'mpesa_passkey', value: 'CHANGE_ME_PASSKEY', category: 'mpesa', description: 'M-Pesa Passkey (for STK Push)', encrypted: true },
  { key: 'mpesa_shortcode', value: '174379', category: 'mpesa', description: 'M-Pesa Business Shortcode (Paybill/Store)' },
  { key: 'mpesa_till_no', value: '174379', category: 'mpesa', description: 'M-Pesa Till Number (if applicable)' },
  { key: 'mpesa_env', value: 'sandbox', category: 'mpesa', description: 'M-Pesa Environment (sandbox or live)' },
  { key: 'mpesa_callback_url', value: `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/mpesa/callback`, category: 'mpesa', description: 'M-Pesa Callback URL' },
  { key: 'mpesa_transaction_type', value: 'CustomerBuyGoodsOnline', category: 'mpesa', description: 'M-Pesa Transaction Type (CustomerPayBillOnline or CustomerBuyGoodsOnline)' },
];

const VENDING_SETTINGS = [
  { key: 'vending_sgc', value: '201457', description: 'Supply Group Code' },
  { key: 'vending_krn', value: '1', description: 'Key Revision Number' },
  { key: 'vending_ti', value: '1', description: 'Tariff Index' },
  { key: 'vending_ea', value: '7', description: 'Encryption Algorithm' },
  { key: 'vending_tct', value: '1', description: 'Token Carrier Type (usually 1 for standard numeric STS)' },
  { key: 'vending_ken', value: '255', description: 'Key Expiry Number' },
];

async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@tokenpap.com').toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`ℹ️  Super admin ${email} already exists - left unchanged`);
    return;
  }
  const password = process.env.SEED_ADMIN_PASSWORD ?? crypto.randomBytes(9).toString('base64url');
  await prisma.user.create({
    data: {
      email,
      username: email.split('@')[0]!,
      name: 'Super Admin',
      passwordHash: await bcrypt.hash(password, 10),
      role: Role.SUPER_ADMIN,
    },
  });
  console.log(`✅ Super admin: ${email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) console.log(`   Generated password (shown once): ${password}`);
}

async function seedConfigs() {
  for (const c of SYSTEM_CONFIGS) {
    const type = c.type ?? ConfigValueType.STRING;
    await prisma.systemConfig.upsert({
      where: { key: c.key },
      update: {},
      create: {
        key: c.key,
        value: c.encrypted ? encryptString(encryptionKey, c.value) : c.value,
        type,
        category: c.category,
        description: c.description,
        isEncrypted: !!c.encrypted,
      },
    });
  }
  // Seeded inactive: the legacy system never applied these (its rows had no
  // is_active flag), so vends use each meter's own STS values until an admin
  // deliberately switches an override on in Settings → Vending.
  for (const v of VENDING_SETTINGS) {
    await prisma.vendingSetting.upsert({
      where: { key: v.key },
      update: {},
      create: { ...v, type: ConfigValueType.INTEGER, isActive: false },
    });
  }
  console.log(`✅ ${SYSTEM_CONFIGS.length} system configs, ${VENDING_SETTINGS.length} vending settings`);
}

async function seedLocations() {
  const { added } = await seedRegions(prisma);
  console.log(`✅ Regions: +${added.counties} counties, +${added.constituencies} constituencies, +${added.wards} wards`);
}

async function main() {
  console.log('🌱 Seeding TokenPap...');
  await seedAdmin();
  await seedConfigs();
  await seedLocations();
  console.log('🌱 Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
