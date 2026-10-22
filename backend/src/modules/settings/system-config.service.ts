import type { PrismaClient, SystemConfig, VendingSetting } from '../../generated/prisma/index.js';
import { ConfigValueType } from '../../shared/types/index.js';
import { decryptString, encryptString } from '../../shared/utils/crypto.js';
import type { Logger } from '../../lib/logger.js';

/** Casts a stored string to its declared type (legacy SystemConfig::getValue semantics). */
export function castConfigValue(type: ConfigValueType, value: string | null | undefined): unknown {
  if (value === null || value === undefined) return undefined;
  switch (type) {
    case ConfigValueType.BOOLEAN:
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    case ConfigValueType.INTEGER: {
      const n = Number.parseInt(value, 10);
      return Number.isNaN(n) ? undefined : n;
    }
    case ConfigValueType.FLOAT: {
      const n = Number.parseFloat(value);
      return Number.isNaN(n) ? undefined : n;
    }
    case ConfigValueType.JSON:
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    default:
      return value;
  }
}

/** Values the legacy seeders shipped as placeholders - treated as "not configured". */
export function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && (value.includes('CHANGE_ME') || value.includes('example.com'));
}

/** How a config value is shown to admins: secrets masked, never returned in plaintext. */
export function presentConfig(config: SystemConfig, plaintext: string | null) {
  const masked = config.isEncrypted && !!plaintext;
  return {
    key: config.key,
    value: masked ? '*'.repeat(Math.min(plaintext!.length, 20)) + (plaintext!.length > 20 ? '…' : '') : plaintext,
    type: config.type,
    category: config.category,
    description: config.description,
    isEncrypted: config.isEncrypted,
    isMasked: masked,
    updatedAt: config.updatedAt,
  };
}

/**
 * Typed read access to the global SystemConfig key/value store and the STS
 * VendingSetting overrides. Constructed once in server.ts and shared via
 * the AppContext; the CRUD routes live in settings.routes.ts.
 */
export class SystemConfigService {
  constructor(private prisma: PrismaClient, private encryptionKey: string, private log: Logger) {}

  /** Decrypted (if needed) raw string value of a config row. */
  plaintext(config: SystemConfig): string | null {
    if (!config.isEncrypted || !config.value) return config.value;
    try {
      return decryptString(this.encryptionKey, config.value);
    } catch (err) {
      this.log.error({ err, key: config.key }, 'Failed to decrypt system config value');
      return null;
    }
  }

  /** Value to persist for `config`, encrypting when the row is marked encrypted. */
  storable(config: Pick<SystemConfig, 'isEncrypted' | 'type'>, value: string | null): string | null {
    if (value === null) return null;
    let v = value;
    if (config.type === ConfigValueType.BOOLEAN) {
      v = ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()) ? 'true' : 'false';
    }
    return config.isEncrypted ? encryptString(this.encryptionKey, v) : v;
  }

  async get<T = unknown>(key: string, fallback?: T): Promise<T | undefined> {
    const config = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!config) return fallback;
    const value = castConfigValue(config.type, this.plaintext(config));
    return (value === undefined ? fallback : value) as T | undefined;
  }

  /** Several keys in one query, as a key → typed value map (missing keys absent). */
  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const out: Record<string, unknown> = {};
    for (const row of rows) out[row.key] = castConfigValue(row.type, this.plaintext(row));
    return out;
  }

  /** Active STS vending overrides as key → number (e.g. { vending_sgc: 201457 }). */
  async vendingOverrides(): Promise<Record<string, number>> {
    const rows: VendingSetting[] = await this.prisma.vendingSetting.findMany({ where: { isActive: true } });
    const out: Record<string, number> = {};
    for (const row of rows) {
      const value = castConfigValue(row.type, row.value);
      if (typeof value === 'number') out[row.key] = value;
    }
    return out;
  }
}
