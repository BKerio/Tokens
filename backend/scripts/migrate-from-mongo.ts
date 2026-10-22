import 'dotenv/config';
import crypto from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoClient, type Db, type Document } from 'mongodb';
import {
  AccountStatus, ConfigValueType, EnquiryStatus, MeterStatus, PaymentChannel, PaymentStatus, Prisma, PropertyType,
  RecordStatus, Role, TokenOwnerType, TokenType, TransactionStatus, VendMode, VendorType,
} from '../src/generated/prisma/index.js';
import { encryptString } from '../src/shared/utils/crypto.js';
import { parseMpesaEnv, parseTransactionType } from '../src/modules/mpesa/daraja.client.js';
import { createPrismaClient } from '../src/lib/prisma.js';

/**
 * One-shot (re-runnable) import of the legacy Laravel/MongoDB TokenPap data
 * into PostgreSQL.
 *
 *   MONGO_URI=... MONGO_DB=... LARAVEL_APP_KEY=base64:... npm run migrate:mongo -- [--dry-run]
 *
 * - Every row is upserted by its old ObjectId (`legacy_mongo_id`), so the
 *   script can be re-run safely; Mongo references are remapped to new UUIDs.
 * - Values Laravel encrypted with APP_KEY (gateway secrets, encrypted system
 *   configs) are decrypted and re-encrypted with ENCRYPTION_KEY/JWT_SECRET.
 * - bcrypt password hashes are carried over, so everyone keeps their password.
 * - Vendor logos are copied from LARAVEL_STORAGE_DIR (default
 *   ../../backend/storage/app/public) into UPLOAD_DIR when present.
 * - Not migrated (no longer needed): personal_access_tokens, sessions, otps,
 *   cache/jobs tables, sms_credentials (unused by the legacy app).
 * - --dry-run performs the whole import inside a transaction and rolls it back.
 */

const DRY_RUN = process.argv.includes('--dry-run');
const required = ['MONGO_URI', 'MONGO_DB', 'LARAVEL_APP_KEY'] as const;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Usage: MONGO_URI=... MONGO_DB=... LARAVEL_APP_KEY=base64:... npm run migrate:mongo -- [--dry-run]`);
    process.exit(1);
  }
}

// A long-running import is better off on the direct session connection than the pooler.
if (process.env.DIRECT_URL) process.env.DATABASE_URL = process.env.DIRECT_URL;
const prisma = createPrismaClient();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET!;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? 'uploads');
const LARAVEL_STORAGE = path.resolve(process.env.LARAVEL_STORAGE_DIR ?? '../../backend/storage/app/public');

type Tx = Prisma.TransactionClient;

// ── Helpers ──────────────────────────────────────────────────────────────────

const report: Record<string, { migrated: number; skipped: number }> = {};
const warnings: string[] = [];

function tally(step: string, migrated: boolean) {
  report[step] ??= { migrated: 0, skipped: 0 };
  report[step][migrated ? 'migrated' : 'skipped']++;
}

function warn(message: string) {
  warnings.push(message);
}

const oid = (doc: Document): string => String(doc._id);
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
const date = (v: unknown): Date | undefined => (v instanceof Date ? v : v ? new Date(String(v)) : undefined);
const stamps = (d: Document) => ({ createdAt: date(d.created_at), updatedAt: date(d.updated_at) });

/** Parses a value Laravel may have stored as a JSON string or as a real object/array. */
function json<T = any>(v: unknown): T | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

/** Reverses Laravel's Crypt::encryptString (AES-256-CBC + HMAC, APP_KEY). Returns null if not decryptable. */
const laravelKey = Buffer.from(process.env.LARAVEL_APP_KEY!.replace(/^base64:/, ''), 'base64');
function laravelDecrypt(payload: string): string | null {
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { iv: string; value: string; mac: string };
    if (!p.iv || !p.value || !p.mac) return null;
    const mac = crypto.createHmac('sha256', laravelKey).update(p.iv + p.value).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(p.mac))) return null;
    const decipher = crypto.createDecipheriv('aes-256-cbc', laravelKey, Buffer.from(p.iv, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(p.value, 'base64')), decipher.final()]).toString('utf8');
    // Crypt::encrypt() (vs encryptString) wraps the value in PHP serialization.
    const serialized = plain.match(/^s:\d+:"([\s\S]*)";$/);
    return serialized ? serialized[1]! : plain;
  } catch {
    return null;
  }
}

/** True when a value is shaped like a Laravel Crypt payload (base64 JSON with iv/value/mac). */
function looksLaravelEncrypted(v: string): boolean {
  try {
    const p = JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
    return !!(p && p.iv && p.value && p.mac);
  } catch {
    return false;
  }
}

/**
 * A legacy secret → new ciphertext. Values Laravel didn't encrypt are taken
 * as plaintext (as the legacy app did). Ciphertext that won't decrypt with
 * LARAVEL_APP_KEY is dropped (→ "not set") rather than stored as garbage.
 */
function reencrypt(v: unknown, label = 'secret'): string | null {
  const raw = str(v);
  if (!raw) return null;
  const plain = laravelDecrypt(raw);
  if (plain === null && looksLaravelEncrypted(raw)) {
    warn(`${label}: encrypted with a different APP_KEY - left empty. Re-run with the production LARAVEL_APP_KEY, or re-enter it in Settings.`);
    return null;
  }
  return encryptString(ENCRYPTION_KEY, plain ?? raw);
}

const ACCOUNT_STATUS: Record<string, AccountStatus> = {
  active: AccountStatus.ACTIVE, pending: AccountStatus.PENDING, suspended: AccountStatus.SUSPENDED, rejected: AccountStatus.REJECTED,
};
const accountStatus = (v: unknown, fallback: AccountStatus = AccountStatus.ACTIVE) => ACCOUNT_STATUS[String(v ?? '').toLowerCase()] ?? fallback;
const recordStatus = (v: unknown) => (String(v ?? '').toLowerCase() === 'inactive' ? RecordStatus.INACTIVE : RecordStatus.ACTIVE);
const meterStatus = (v: unknown) =>
  ({ inactive: MeterStatus.INACTIVE, maintenance: MeterStatus.MAINTENANCE })[String(v ?? '').toLowerCase()] ?? MeterStatus.ACTIVE;
const configType = (v: unknown): ConfigValueType =>
  ({ boolean: ConfigValueType.BOOLEAN, number: ConfigValueType.INTEGER, integer: ConfigValueType.INTEGER, float: ConfigValueType.FLOAT, json: ConfigValueType.JSON })[
    String(v ?? '').toLowerCase()
  ] ?? ConfigValueType.STRING;

/** Laravel's bcrypt "$2y$" is the same algorithm node's bcrypt calls "$2b$". */
const bcryptHash = (hash: string) => hash.replace(/^\$2y\$/, '$2b$');

async function all(db: Db, name: string): Promise<Document[]> {
  return db.collection(name).find({}).sort({ _id: 1 }).toArray();
}

/** legacy ObjectId string → new id, per collection. */
const ids = {
  users: new Map<string, string>(), // admins + users (both map to users.id)
  vendors: new Map<string, string>(),
  landlords: new Map<string, string>(),
  meters: new Map<string, string>(),
  meterNumbers: new Map<string, string>(),
  customers: new Map<string, string>(),
  properties: new Map<string, string>(),
  units: new Map<string, string>(),
  payments: new Map<string, string>(),
};
const ref = (map: Map<string, string>, v: unknown): string | null => (v ? map.get(String(v)) ?? null : null);

// ── Steps ────────────────────────────────────────────────────────────────────

async function migrateLocations(tx: Tx, db: Db) {
  const [counties, constituencies, wards] = await Promise.all([all(db, 'location'), all(db, 'constituencies'), all(db, 'location_area')]);
  if (counties.length === 0) {
    warn('No legacy location data found - run `npm run db:seed` to load counties/constituencies/wards.');
    return;
  }
  for (const c of counties) {
    const data = { name: String(c.description), isActive: Number(c.status ?? 1) === 1 };
    await tx.county.upsert({ where: { id: Number(c._id) }, update: data, create: { id: Number(c._id), ...data } });
    tally('counties', true);
  }
  for (const c of constituencies) {
    const data = { name: String(c.description), countyId: Number(c.location_id), isActive: Number(c.status ?? 1) === 1 };
    await tx.constituency.upsert({ where: { id: Number(c._id) }, update: data, create: { id: Number(c._id), ...data } });
    tally('constituencies', true);
  }
  for (let i = 0; i < wards.length; i += 500) {
    const chunk = wards.slice(i, i + 500).map((w) => ({
      id: Number(w._id),
      name: String(w.description),
      countyId: Number(w.location_id),
      constituencyId: Number(w.constituency_id),
      isActive: Number(w.status ?? 1) === 1,
    }));
    await tx.ward.createMany({ data: chunk, skipDuplicates: true });
    chunk.forEach(() => tally('wards', true));
  }
}

const ADMIN_ROLE: Record<string, Role> = { system_admin: Role.SUPER_ADMIN, admin: Role.SUPER_ADMIN, attendance_staff: Role.ADMIN };
const USER_ROLE: Record<string, Role> = { vendor: Role.VENDOR, landlord: Role.LANDLORD, admin: Role.ADMIN, system_admin: Role.SUPER_ADMIN };

async function uniqueUsername(tx: Tx, wanted: string, legacyId: string): Promise<string> {
  const base = wanted.trim().toLowerCase().replace(/\s+/g, '.') || `user${legacyId.slice(-6)}`;
  let candidate = base;
  for (let i = 2; ; i++) {
    const clash = await tx.user.findFirst({ where: { username: { equals: candidate, mode: 'insensitive' }, NOT: { legacyMongoId: legacyId } } });
    if (!clash) return candidate;
    candidate = `${base}${i}`;
  }
}

async function migrateUsers(tx: Tx, db: Db, statusFor: Map<string, AccountStatus>) {
  const sources: [string, Document[], Record<string, Role>][] = [
    ['admins', await all(db, 'admins'), ADMIN_ROLE],
    ['users', await all(db, 'users'), USER_ROLE],
  ];

  for (const [collection, docs, roleMap] of sources) {
    for (const d of docs) {
      const legacyId = oid(d);
      const email = str(d.email)?.toLowerCase();
      const role = roleMap[String(d.role ?? '').toLowerCase()];
      if (!email || !d.password || !role) {
        warn(`${collection} ${legacyId}: skipped (missing email/password or unknown role "${d.role}")`);
        tally(collection, false);
        continue;
      }
      if (collection === 'admins' && String(d.role) === 'attendance_staff') {
        warn(`admins ${email}: legacy role attendance_staff migrated as ADMIN - review this account`);
      }

      // Re-runs match on legacy id; first run may match an account seeded with the same email.
      const existing =
        (await tx.user.findUnique({ where: { legacyMongoId: legacyId } })) ??
        (await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }));
      if (existing && existing.legacyMongoId && existing.legacyMongoId !== legacyId) {
        warn(`${collection} ${email}: email already used by another migrated account - skipped`);
        tally(collection, false);
        continue;
      }

      const data = {
        name: str(d.name) ?? email,
        username: await uniqueUsername(tx, str(d.username) ?? email.split('@')[0]!, legacyId),
        email,
        phone: str(d.phone),
        passwordHash: bcryptHash(String(d.password)),
        role,
        status: d.status ? accountStatus(d.status) : statusFor.get(legacyId) ?? AccountStatus.ACTIVE,
        bio: str(d.bio),
        profileImage: str(d.profile_image),
        legacyMongoId: legacyId,
        ...stamps(d),
      };
      const user = existing
        ? await tx.user.update({ where: { id: existing.id }, data })
        : await tx.user.create({ data });
      ids.users.set(legacyId, user.id);
      tally(collection, true);
    }
  }
}

function copyLogo(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  if (/^https?:\/\//.test(logoUrl) && !logoUrl.includes('/storage/')) return logoUrl;
  const relative = logoUrl.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?storage\//, '').replace(/^\/+/, '');
  const source = path.join(LARAVEL_STORAGE, relative);
  const target = path.join(UPLOAD_DIR, relative);
  if (existsSync(source)) {
    if (!DRY_RUN) {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
  } else {
    warn(`Vendor logo file not found at ${source} - copy it into ${UPLOAD_DIR} manually`);
  }
  return relative;
}

async function migrateVendors(tx: Tx, db: Db) {
  for (const d of await all(db, 'vendors')) {
    const legacyId = oid(d);
    const userId = ref(ids.users, d.user_id);
    if (!userId) {
      warn(`vendor ${d.business_name ?? legacyId}: user ${d.user_id} not migrated - skipped`);
      tally('vendors', false);
      continue;
    }
    const settings = json<Record<string, unknown>>(d.dashboard_settings) ?? {};
    const data = {
      userId,
      businessName: str(d.business_name) ?? 'Unnamed vendor',
      address: str(d.address),
      accountId: str(d.account_id) ?? `LEGACY-${legacyId.slice(-8)}`,
      paybill: str(d.paybill),
      vendorType: String(d.vendor_type ?? '').toLowerCase() === 'company' ? VendorType.COMPANY : VendorType.INDIVIDUAL,
      bankName: str(d.bank_name),
      status: accountStatus(d.status),
      logoPath: copyLogo(str(d.logo_url)),
      dashboardSettings: {
        primaryColor: settings.primary_color ?? settings.primaryColor ?? null,
        tagline: settings.tagline ?? null,
        showLogoInSidebar: settings.show_logo_in_sidebar ?? settings.showLogoInSidebar ?? null,
      },
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    const vendor = await tx.vendor.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    ids.vendors.set(legacyId, vendor.id);
    tally('vendors', true);
  }
}

async function migrateLandlords(tx: Tx, db: Db) {
  for (const d of await all(db, 'landlords')) {
    const legacyId = oid(d);
    const userId = ref(ids.users, d.user_id);
    if (!userId) {
      warn(`landlord ${d.full_name ?? legacyId}: user ${d.user_id} not migrated - skipped`);
      tally('landlords', false);
      continue;
    }
    const data = {
      userId,
      fullName: str(d.full_name) ?? 'Unnamed landlord',
      phone: str(d.phone) ?? '',
      paymentAccount: str(d.payment_account) ?? '',
      status: accountStatus(d.status),
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    const landlord = await tx.landlord.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    ids.landlords.set(legacyId, landlord.id);
    tally('landlords', true);
  }
}

/** Derives users.status for vendor/landlord accounts from their profile's status (legacy users rarely had one). */
async function profileStatuses(db: Db): Promise<Map<string, AccountStatus>> {
  const map = new Map<string, AccountStatus>();
  for (const v of await all(db, 'vendors')) {
    if (v.user_id) map.set(String(v.user_id), String(v.status) === 'rejected' ? AccountStatus.SUSPENDED : accountStatus(v.status));
  }
  for (const l of await all(db, 'landlords')) if (l.user_id) map.set(String(l.user_id), accountStatus(l.status));
  return map;
}

async function migrateGatewayConfigs(tx: Tx, db: Db) {
  const mpesaData = (d: Document, label = String(d._id ?? "embedded")) => ({
    consumerKeyEnc: reencrypt(d.consumer_key, `mpesa ${label} consumer_key`),
    consumerSecretEnc: reencrypt(d.consumer_secret, `mpesa ${label} consumer_secret`),
    passkeyEnc: reencrypt(d.passkey, `mpesa ${label} passkey`),
    shortcode: str(d.shortcode),
    tillNo: str(d.till_no),
    env: parseMpesaEnv(d.env),
    callbackUrl: str(d.callback_url),
    transactionType: parseTransactionType(d.transaction_type),
  });

  const vendorsWithMpesa = new Set<string>();
  for (const d of await all(db, 'mpesa_configs')) {
    const legacyId = oid(d);
    const vendorId = ref(ids.vendors, d.vendor_id);
    const landlordId = vendorId ? null : ref(ids.landlords, d.landlord_id);
    if (!vendorId && !landlordId) {
      warn(`mpesa_config ${legacyId}: owner not migrated - skipped`);
      tally('mpesa_configs', false);
      continue;
    }
    const data = { ...mpesaData(d), vendorId, landlordId, legacyMongoId: legacyId, ...stamps(d) };
    await tx.mpesaConfig.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    if (vendorId) vendorsWithMpesa.add(vendorId);
    tally('mpesa_configs', true);
  }

  const vendorsWithSms = new Set<string>();
  for (const d of await all(db, 'sms_configs')) {
    const legacyId = oid(d);
    const vendorId = ref(ids.vendors, d.vendor_id);
    if (!vendorId) {
      warn(`sms_config ${legacyId}: vendor not migrated - skipped`);
      tally('sms_configs', false);
      continue;
    }
    const data = {
      vendorId,
      provider: str(d.provider),
      apiUrl: str(d.api_url),
      apiKeyEnc: reencrypt(d.api_key, `sms_config ${legacyId} api_key`),
      partnerId: str(d.partner_id),
      shortcode: str(d.shortcode),
      enabled: d.enabled === undefined || d.enabled === null ? true : Boolean(d.enabled) && d.enabled !== 'false',
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    await tx.smsConfig.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    vendorsWithSms.add(vendorId);
    tally('sms_configs', true);
  }

  // Older vendors kept their config embedded on the vendor document.
  for (const v of await all(db, 'vendors')) {
    const vendorId = ref(ids.vendors, v._id);
    if (!vendorId) continue;
    const mpesa = json<Document>(v.mpesa_config);
    if (mpesa && Object.keys(mpesa).length && !vendorsWithMpesa.has(vendorId) && (mpesa.consumer_key || mpesa.shortcode)) {
      const exists = await tx.mpesaConfig.findUnique({ where: { vendorId } });
      if (!exists) await tx.mpesaConfig.create({ data: { ...mpesaData(mpesa), vendorId } });
      tally('mpesa_configs (embedded)', !exists);
    }
    const sms = json<Document>(v.sms_config);
    if (sms && Object.keys(sms).length && !vendorsWithSms.has(vendorId) && (sms.api_key || sms.api_url)) {
      const exists = await tx.smsConfig.findUnique({ where: { vendorId } });
      if (!exists) {
        await tx.smsConfig.create({
          data: { vendorId, provider: str(sms.provider), apiUrl: str(sms.api_url), apiKeyEnc: reencrypt(sms.api_key), partnerId: str(sms.partner_id), shortcode: str(sms.shortcode) },
        });
      }
      tally('sms_configs (embedded)', !exists);
    }
  }
}

async function migrateSettings(tx: Tx, db: Db) {
  for (const d of await all(db, 'system_configs')) {
    const key = str(d.key);
    if (!key) continue;
    const isEncrypted = Boolean(d.is_encrypted);
    const raw = str(d.value);
    const data = {
      value: isEncrypted ? reencrypt(raw, `system_config ${key}`) : raw,
      type: configType(d.type),
      category: str(d.category) ?? 'general',
      description: str(d.description),
      isEncrypted,
      ...stamps(d),
    };
    if (isEncrypted && raw && !looksLaravelEncrypted(raw)) {
      warn(`system_config ${key}: was stored in plaintext by the legacy app - now encrypted`);
    }
    await tx.systemConfig.upsert({ where: { key }, update: data, create: { key, ...data } });
    tally('system_configs', true);
  }

  for (const d of await all(db, 'vending_settings')) {
    const key = str(d.key);
    if (!key) continue;
    // Legacy only applied rows with is_active === true (none had the flag) - preserve that.
    const data = { value: str(d.value), type: configType(d.type), description: str(d.description), isActive: d.is_active === true, ...stamps(d) };
    await tx.vendingSetting.upsert({ where: { key }, update: data, create: { key, ...data } });
    tally('vending_settings', true);
  }
}

async function migrateMeters(tx: Tx, db: Db) {
  for (const d of await all(db, 'meters')) {
    const legacyId = oid(d);
    const meterNumber = str(d.meter_number);
    if (!meterNumber) {
      warn(`meter ${legacyId}: no meter number - skipped`);
      tally('meters', false);
      continue;
    }
    const clash = await tx.meter.findUnique({ where: { meterNumber } });
    if (clash && clash.legacyMongoId !== legacyId) {
      warn(`meter ${meterNumber}: duplicate meter number - skipped`);
      tally('meters', false);
      continue;
    }
    const data = {
      meterNumber,
      type: str(d.type) ?? 'electricity',
      initialReading: num(d.initial_reading) ?? 0,
      pricePerUnit: num(d.price_per_unit) ?? 0,
      status: meterStatus(d.status),
      sgc: int(d.sgc), krn: int(d.krn), ti: int(d.ti), ea: int(d.ea), ken: int(d.ken),
      vendorId: ref(ids.vendors, d.vendor_id),
      landlordId: ref(ids.landlords, d.landlord_id),
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    if (d.vendor_id && !data.vendorId) warn(`meter ${meterNumber}: vendor ${d.vendor_id} not found - left unassigned`);
    if (d.landlord_id && !data.landlordId) warn(`meter ${meterNumber}: landlord ${d.landlord_id} not found - left unassigned`);
    const meter = await tx.meter.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    ids.meters.set(legacyId, meter.id);
    ids.meterNumbers.set(legacyId, meter.meterNumber);
    tally('meters', true);
  }
}

async function migrateCustomers(tx: Tx, db: Db) {
  const [counties, constituencies, wards] = await Promise.all([
    tx.county.findMany({ select: { id: true } }),
    tx.constituency.findMany({ select: { id: true } }),
    tx.ward.findMany({ select: { id: true } }),
  ]);
  const has = (set: { id: number }[]) => {
    const s = new Set(set.map((x) => x.id));
    return (v: unknown) => {
      const n = int(v);
      return n !== null && s.has(n) ? n : null;
    };
  };
  const county = has(counties), constituency = has(constituencies), ward = has(wards);

  for (const d of await all(db, 'customers')) {
    const legacyId = oid(d);
    const data = {
      name: str(d.name) ?? 'Customer',
      phone: str(d.phone) ?? '',
      email: str(d.email),
      address: str(d.address),
      status: recordStatus(d.status),
      vendorId: ref(ids.vendors, d.vendor_id),
      meterId: ref(ids.meters, d.meter_id),
      countyId: county(d.county_id),
      constituencyId: constituency(d.constituency_id),
      wardId: ward(d.ward_id),
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    if (d.meter_id && !data.meterId) warn(`customer ${data.name}: meter ${d.meter_id} not found`);
    const customer = await tx.customer.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    ids.customers.set(legacyId, customer.id);
    tally('customers', true);
  }
}

async function migrateProperties(tx: Tx, db: Db) {
  for (const d of await all(db, 'properties')) {
    const legacyId = oid(d);
    const landlordId = ref(ids.landlords, d.landlord_id);
    if (!landlordId) {
      warn(`property ${d.name ?? legacyId}: landlord not migrated - skipped`);
      tally('properties', false);
      continue;
    }
    const data = {
      landlordId,
      ownerName: str(d.owner) ?? '',
      name: str(d.name) ?? 'Property',
      propertyType: String(d.property_type ?? '').toLowerCase() === 'zone' ? PropertyType.ESTATE : PropertyType.APARTMENT,
      noOfUnits: int(d.no_of_units) ?? 1,
      location: str(d.location) ?? '',
      status: recordStatus(d.status),
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    const p = await tx.property.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    ids.properties.set(legacyId, p.id);
    tally('properties', true);
  }

  // Legacy zones/routes/streets are not carried over: units hang directly off their property.

  const linkedMeters = new Set<string>();
  for (const d of await all(db, 'property_units')) {
    const legacyId = oid(d);
    const landlordId = ref(ids.landlords, d.landlord_id);
    const propertyId = ref(ids.properties, d.property_id);
    if (!landlordId || !propertyId) { tally('property_units', false); warn(`unit ${d.name ?? legacyId}: property not migrated - skipped`); continue; }

    let meterId = ref(ids.meters, d.meter_id);
    if (meterId && linkedMeters.has(meterId)) {
      warn(`unit ${d.name}: meter already linked to another unit - unlinked`);
      meterId = null;
    }
    if (meterId) linkedMeters.add(meterId);

    const data = {
      landlordId, propertyId,
      name: str(d.name) ?? 'Unit',
      unitNumber: str(d.unit_number),
      meterId,
      status: recordStatus(d.status),
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    const u = await tx.propertyUnit.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    ids.units.set(legacyId, u.id);
    tally('property_units', true);
  }

  for (const d of await all(db, 'landlord_tenants')) {
    const legacyId = oid(d);
    const landlordId = ref(ids.landlords, d.landlord_id);
    const propertyId = ref(ids.properties, d.property_id);
    if (!landlordId || !propertyId) { tally('landlord_tenants', false); warn(`tenant ${d.name ?? legacyId}: property not migrated - skipped`); continue; }
    // Tenants on a legacy zone/route/street keep their property but no unit.
    const unitId = String(d.node_type) === 'unit' ? ref(ids.units, d.node_id) : null;
    const data = {
      landlordId, propertyId, unitId,
      name: str(d.name) ?? 'Tenant',
      phone: str(d.phone) ?? '',
      email: str(d.email),
      status: recordStatus(d.status),
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    await tx.landlordTenant.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    tally('landlord_tenants', true);
  }
}

async function migratePayments(tx: Tx, db: Db) {
  for (const d of await all(db, 'payments')) {
    const legacyId = oid(d);
    const checkout = str(d.checkout_request_id);
    const receipt = str(d.mpesa_receipt_number);
    const channel = checkout?.startsWith('NCBA-') ? PaymentChannel.NCBA : checkout?.startsWith('C2B-') ? PaymentChannel.C2B : PaymentChannel.STK;
    const status = ({ confirmed: PaymentStatus.CONFIRMED, failed: PaymentStatus.FAILED } as Record<string, PaymentStatus>)[String(d.status)] ?? PaymentStatus.PENDING;
    const data = {
      channel,
      status,
      merchantRequestId: str(d.merchant_request_id),
      checkoutRequestId: checkout,
      accountReference: str(d.account_reference),
      phone: str(d.phone) ?? 'UNKNOWN',
      amount: num(d.amount) ?? 0,
      // Failed STK rows carried a fake "FAILED-<checkout>" receipt only to dodge a unique index.
      mpesaReceiptNumber: receipt && !receipt.startsWith('FAILED-') ? receipt : null,
      resultCode: str(d.result_code),
      resultDesc: str(d.result_desc),
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    const clash = await tx.payment.findFirst({
      where: {
        NOT: { legacyMongoId: legacyId },
        OR: [...(data.checkoutRequestId ? [{ checkoutRequestId: data.checkoutRequestId }] : []), ...(data.mpesaReceiptNumber ? [{ mpesaReceiptNumber: data.mpesaReceiptNumber }] : [])],
      },
    });
    if (clash && (data.checkoutRequestId || data.mpesaReceiptNumber)) {
      warn(`payment ${receipt ?? checkout}: duplicate checkout/receipt - skipped`);
      tally('payments', false);
      continue;
    }
    const p = await tx.payment.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    ids.payments.set(legacyId, p.id);
    tally('payments', true);
  }
}

const TOKEN_TYPE: Record<string, TokenType> = {
  credit: TokenType.CREDIT, clear_tamper: TokenType.CLEAR_TAMPER, clear_credit: TokenType.CLEAR_CREDIT, set_max_overdraft: TokenType.SET_MAX_OVERDRAFT,
};
const OWNER_TYPE: Record<string, TokenOwnerType> = { vendor: TokenOwnerType.VENDOR, landlord: TokenOwnerType.LANDLORD, unassigned: TokenOwnerType.UNASSIGNED };

async function migrateTokenTransactions(tx: Tx, db: Db) {
  for (const d of await all(db, 'token_transactions')) {
    const legacyId = oid(d);
    const tokens = Array.isArray(d.tokens) ? d.tokens.map(String) : json<string[]>(d.tokens) ?? [];
    const data = {
      status: String(d.status).toLowerCase() === 'success' ? TransactionStatus.SUCCESS : TransactionStatus.FAILED,
      tokenType: TOKEN_TYPE[String(d.token_type ?? 'credit').toLowerCase()] ?? TokenType.CREDIT,
      vendMode: d.vend_mode ? (String(d.vend_mode).toLowerCase() === 'unit' ? VendMode.UNIT : VendMode.VALUE) : null,
      ownerType: d.owner_type ? OWNER_TYPE[String(d.owner_type).toLowerCase()] ?? null : null,
      amount: num(d.amount),
      units: num(d.units),
      tokens,
      controlIndex: int(d.control_index),
      controlValue: int(d.control_value),
      externalTransactionId: str(d.transaction_id),
      transactionTime: date(d.transaction_time) ?? null,
      sendSms: Boolean(d.send_sms),
      smsSent: Boolean(d.sms_sent),
      phone: str(d.phone),
      prismMessageId: str(d.prism_message_id),
      description: str(d.description),
      meterNumberSnapshot: d.meter_id ? ids.meterNumbers.get(String(d.meter_id)) ?? null : null,
      meterId: ref(ids.meters, d.meter_id),
      vendorId: ref(ids.vendors, d.vendor_id),
      landlordId: ref(ids.landlords, d.landlord_id),
      customerId: ref(ids.customers, d.customer_id),
      paymentId: ref(ids.payments, d.payment_id),
      actorUserId: ref(ids.users, d.actor_user_id),
      legacyMongoId: legacyId,
      createdAt: date(d.created_at),
    };
    await tx.tokenTransaction.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    tally('token_transactions', true);
  }
}

async function migrateEnquiries(tx: Tx, db: Db) {
  for (const d of await all(db, 'contact_enquiries')) {
    const legacyId = oid(d);
    const parsed = json<unknown>(d.meter_type);
    const meterTypes = Array.isArray(parsed) ? parsed.map(String) : d.meter_type ? [String(d.meter_type)] : [];
    const data = {
      firstName: str(d.first_name) ?? '',
      lastName: str(d.last_name) ?? '',
      email: str(d.email) ?? '',
      phone: str(d.phone) ?? '',
      city: str(d.city) ?? '',
      premisesType: str(d.premises_type) ?? '',
      residenceType: str(d.residence_type) ?? '',
      meterTypes,
      mainMeterType: str(d.main_meter_type) ?? '',
      message: str(d.message) ?? '',
      status: ({ reviewed: EnquiryStatus.REVIEWED, archived: EnquiryStatus.ARCHIVED } as Record<string, EnquiryStatus>)[String(d.status)] ?? EnquiryStatus.PENDING,
      legacyMongoId: legacyId,
      ...stamps(d),
    };
    await tx.contactEnquiry.upsert({ where: { legacyMongoId: legacyId }, update: data, create: data });
    tally('contact_enquiries', true);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

class DryRunRollback extends Error {}

async function main() {
  const mongo = new MongoClient(process.env.MONGO_URI!, { serverSelectionTimeoutMS: 20_000 });
  await mongo.connect();
  const db = mongo.db(process.env.MONGO_DB);
  console.log(`📦 Migrating MongoDB "${process.env.MONGO_DB}" → PostgreSQL${DRY_RUN ? ' (DRY RUN - nothing will be saved)' : ''}`);

  try {
    for (const name of ['personal_access_tokens', 'sessions', 'otps', 'sms_credentials']) {
      const count = await db.collection(name).estimatedDocumentCount().catch(() => 0);
      if (count) report[`${name} (not migrated)`] = { migrated: 0, skipped: count };
    }

    await prisma.$transaction(
      async (tx) => {
        await migrateLocations(tx, db);
        await migrateUsers(tx, db, await profileStatuses(db));
        await migrateVendors(tx, db);
        await migrateLandlords(tx, db);
        await migrateGatewayConfigs(tx, db);
        await migrateSettings(tx, db);
        await migrateMeters(tx, db);
        await migrateCustomers(tx, db);
        await migrateProperties(tx, db);
        await migratePayments(tx, db);
        await migrateTokenTransactions(tx, db);
        await migrateEnquiries(tx, db);
        if (DRY_RUN) throw new DryRunRollback();
      },
      { timeout: 15 * 60 * 1000, maxWait: 60_000 },
    );
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  } finally {
    await mongo.close();
  }

  console.log('\nCollection'.padEnd(34) + 'migrated  skipped');
  for (const [step, r] of Object.entries(report)) console.log(`${step.padEnd(33)} ${String(r.migrated).padStart(8)} ${String(r.skipped).padStart(8)}`);
  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`   - ${w}`);
  }
  console.log(DRY_RUN ? '\n🔁 Dry run complete - all changes rolled back.' : '\n✅ Migration complete. Run `npm run db:seed` to fill any defaults that were missing.');
}

main()
  .catch((err) => {
    console.error('❌ Migration failed - nothing was saved:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
