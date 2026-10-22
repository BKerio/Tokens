import { AppContext } from '../../context.js';
import type { MpesaConfig, SmsConfig } from '../../generated/prisma/index.js';
import { MpesaEnv, MpesaTransactionType } from '../../shared/types/index.js';
import { decryptString, encryptString } from '../../shared/utils/crypto.js';
import { DarajaCredentials, firstMissingDarajaField, parseMpesaEnv, parseTransactionType } from '../mpesa/daraja.client.js';
import type { VendorSmsConfig } from '../../integrations/sms.service.js';
import { isPlaceholder } from './system-config.service.js';

/** M-Pesa config as shown to clients - secrets reduced to "is set" booleans. */
export function presentMpesaConfig(config: MpesaConfig | null) {
  if (!config) return null;
  return {
    id: config.id,
    consumerKeySet: !!config.consumerKeyEnc,
    consumerSecretSet: !!config.consumerSecretEnc,
    passkeySet: !!config.passkeyEnc,
    shortcode: config.shortcode,
    tillNo: config.tillNo,
    env: config.env,
    callbackUrl: config.callbackUrl,
    transactionType: config.transactionType,
    updatedAt: config.updatedAt,
  };
}

/** SMS config as shown to clients - API key reduced to an "is set" boolean. */
export function presentSmsConfig(config: SmsConfig | null) {
  if (!config) return null;
  return {
    id: config.id,
    provider: config.provider,
    apiUrl: config.apiUrl,
    apiKeySet: !!config.apiKeyEnc,
    partnerId: config.partnerId,
    shortcode: config.shortcode,
    enabled: config.enabled,
    updatedAt: config.updatedAt,
  };
}

export interface MpesaConfigInput {
  consumerKey?: string;
  consumerSecret?: string;
  passkey?: string;
  shortcode?: string;
  tillNo?: string;
  env?: MpesaEnv;
  transactionType?: MpesaTransactionType;
  callbackUrl?: string;
}

export interface SmsConfigInput {
  provider?: string;
  apiUrl?: string;
  apiKey?: string;
  partnerId?: string;
  shortcode?: string;
  enabled?: boolean;
}

/**
 * Encrypted storage + resolution of payment/SMS gateway credentials: the
 * per-vendor / per-landlord Daraja configs, the global M-Pesa fallback in
 * SystemConfig, and vendor SMS overrides.
 */
export class GatewayCredentialsService {
  constructor(private app: AppContext) {}

  private enc(value: string): string {
    return encryptString(this.app.config.ENCRYPTION_KEY, value);
  }

  private dec(value: string | null): string | null {
    try {
      return decryptString(this.app.config.ENCRYPTION_KEY, value);
    } catch (err) {
      this.app.log.error({ err }, 'Failed to decrypt stored gateway credential');
      return null;
    }
  }

  /** Creates or patches the Daraja config owned by a vendor or landlord. Blank fields are left unchanged. */
  async upsertMpesaConfig(owner: { vendorId: string } | { landlordId: string }, input: MpesaConfigInput) {
    const data = {
      ...(input.consumerKey ? { consumerKeyEnc: this.enc(input.consumerKey) } : {}),
      ...(input.consumerSecret ? { consumerSecretEnc: this.enc(input.consumerSecret) } : {}),
      ...(input.passkey ? { passkeyEnc: this.enc(input.passkey) } : {}),
      ...(input.shortcode !== undefined ? { shortcode: input.shortcode } : {}),
      ...(input.tillNo !== undefined ? { tillNo: input.tillNo } : {}),
      ...(input.env ? { env: input.env } : {}),
      ...(input.transactionType ? { transactionType: input.transactionType } : {}),
      ...(input.callbackUrl !== undefined ? { callbackUrl: input.callbackUrl } : {}),
    };
    const where = 'vendorId' in owner ? { vendorId: owner.vendorId } : { landlordId: owner.landlordId };
    return this.app.prisma.mpesaConfig.upsert({ where, update: data, create: { ...owner, ...data } });
  }

  async upsertSmsConfig(vendorId: string, input: SmsConfigInput) {
    const data = {
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.apiUrl !== undefined ? { apiUrl: input.apiUrl } : {}),
      ...(input.apiKey ? { apiKeyEnc: this.enc(input.apiKey) } : {}),
      ...(input.partnerId !== undefined ? { partnerId: input.partnerId } : {}),
      ...(input.shortcode !== undefined ? { shortcode: input.shortcode } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    };
    return this.app.prisma.smsConfig.upsert({ where: { vendorId }, update: data, create: { vendorId, ...data } });
  }

  /** Decrypted SMS override for a vendor, or null to use the global gateway. */
  async vendorSmsConfig(vendorId: string | null | undefined): Promise<VendorSmsConfig | null> {
    if (!vendorId) return null;
    const config = await this.app.prisma.smsConfig.findUnique({ where: { vendorId } });
    if (!config) return null;
    return {
      provider: config.provider,
      apiUrl: config.apiUrl,
      apiKey: this.dec(config.apiKeyEnc),
      partnerId: config.partnerId,
      shortcode: config.shortcode,
      enabled: config.enabled,
    };
  }

  private async defaultCallbackUrl(): Promise<string> {
    const configured = await this.app.settings.get<string>('mpesa_callback_url');
    return configured && !isPlaceholder(configured) ? configured : `${this.app.config.APP_URL}/api/mpesa/callback`;
  }

  /** Decrypts a stored Daraja config into STK-ready credentials (fields may be missing). */
  async fromStoredConfig(config: MpesaConfig): Promise<Partial<DarajaCredentials>> {
    return {
      env: config.env,
      consumerKey: this.dec(config.consumerKeyEnc) ?? undefined,
      consumerSecret: this.dec(config.consumerSecretEnc) ?? undefined,
      passkey: this.dec(config.passkeyEnc) ?? undefined,
      shortcode: config.shortcode ?? undefined,
      tillNo: config.tillNo,
      transactionType: config.transactionType,
      callbackUrl: config.callbackUrl || (await this.defaultCallbackUrl()),
    };
  }

  /** The global (SystemConfig mpesa_*) Daraja credentials, or null if not configured. */
  async globalCredentials(): Promise<DarajaCredentials | null> {
    const g = await this.app.settings.getMany([
      'mpesa_env', 'mpesa_consumer_key', 'mpesa_consumer_secret', 'mpesa_passkey',
      'mpesa_shortcode', 'mpesa_till_no', 'mpesa_transaction_type',
    ]);
    const secret = (v: unknown) => (typeof v === 'string' && v && !isPlaceholder(v) ? v : undefined);
    const creds: Partial<DarajaCredentials> = {
      env: parseMpesaEnv(g.mpesa_env),
      consumerKey: secret(g.mpesa_consumer_key),
      consumerSecret: secret(g.mpesa_consumer_secret),
      passkey: secret(g.mpesa_passkey),
      shortcode: g.mpesa_shortcode ? String(g.mpesa_shortcode) : undefined,
      tillNo: g.mpesa_till_no ? String(g.mpesa_till_no) : undefined,
      transactionType: parseTransactionType(g.mpesa_transaction_type),
      callbackUrl: await this.defaultCallbackUrl(),
    };
    return firstMissingDarajaField(creds) ? null : (creds as DarajaCredentials);
  }
}
