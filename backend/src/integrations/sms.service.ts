import type { EnvConfig } from '../lib/env.js';
import type { Logger } from '../lib/logger.js';
import { normalizeMsisdn } from '../shared/utils/phone.js';
import { isPlaceholder, type SystemConfigService } from '../modules/settings/system-config.service.js';

const DEFAULT_SMS_URL = 'https://quicksms.advantasms.com/api/services/sendsms/';

/** A vendor's own SMS gateway settings (secrets already decrypted). */
export interface VendorSmsConfig {
  provider?: string | null;
  apiUrl?: string | null;
  apiKey?: string | null;
  partnerId?: string | null;
  shortcode?: string | null;
  enabled?: boolean | null;
}

interface ResolvedSmsConfig {
  provider: string;
  apiKey?: string;
  partnerId?: string;
  shortcode?: string;
  apiUrl: string;
}

function pick(...values: (string | null | undefined | unknown)[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '' && !isPlaceholder(v)) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/**
 * Bulk-SMS gateway client (Advanta-compatible "apikey/partnerID/shortcode/mobile"
 * API). Resolution order for every setting: vendor override → global
 * SystemConfig (sms_*) → environment fallback.
 */
export class SmsService {
  constructor(private settings: SystemConfigService, private config: EnvConfig, private log: Logger) {}

  private async resolve(vendor?: VendorSmsConfig | null): Promise<ResolvedSmsConfig> {
    const g = await this.settings.getMany(['sms_provider', 'sms_api_key', 'sms_partner_id', 'sms_shortcode', 'sms_api_url']);

    let apiUrl = pick(vendor?.apiUrl, g.sms_api_url, this.config.SMS_API_URL) ?? DEFAULT_SMS_URL;
    if (apiUrl.includes('advantasms.com') && !apiUrl.endsWith('/')) apiUrl += '/';

    let provider = pick(vendor?.provider, g.sms_provider) ?? 'advanta';
    if (provider === 'fornax' && apiUrl.includes('advantasms.com')) provider = 'advanta';

    return {
      provider,
      apiUrl,
      apiKey: pick(vendor?.apiKey, g.sms_api_key, this.config.SMS_API_KEY),
      partnerId: pick(vendor?.partnerId, g.sms_partner_id, this.config.SMS_PARTNER_ID),
      shortcode: pick(vendor?.shortcode, g.sms_shortcode, this.config.SMS_SHORTCODE),
    };
  }

  /**
   * Sends one SMS. Never throws - returns false (and logs) on any failure.
   * When a vendor's own gateway rejects the message it is retried through the
   * global gateway, so a bad vendor setting never stops a customer getting
   * their token; pass `fallbackToGlobal: false` to test the vendor's settings alone.
   */
  async send(phone: string, message: string, vendor?: VendorSmsConfig | null, opts: { fallbackToGlobal?: boolean } = {}): Promise<boolean> {
    try {
      const enabled = vendor?.enabled ?? (await this.settings.get<boolean>('sms_enabled', true));
      if (enabled === false) {
        this.log.warn('SMS service is disabled');
        return false;
      }

      const msisdn = normalizeMsisdn(phone) ?? phone.replace(/\D/g, '');
      const cfg = await this.resolve(vendor);
      if (await this.deliver(msisdn, message, cfg)) return true;
      if (!vendor || opts.fallbackToGlobal === false) return false;

      const global = await this.resolve(null);
      if (JSON.stringify(global) === JSON.stringify(cfg)) return false;
      this.log.warn({ phone: msisdn, vendorPartnerId: cfg.partnerId }, "Vendor's SMS gateway failed - retrying through the global gateway");
      return await this.deliver(msisdn, message, global);
    } catch (err) {
      this.log.error({ err }, 'SMS send failed');
      return false;
    }
  }

  private async deliver(msisdn: string, message: string, cfg: ResolvedSmsConfig): Promise<boolean> {
    if (!cfg.apiKey || !cfg.partnerId || !cfg.shortcode || !cfg.apiUrl) {
      this.log.error(
        {
          apiKeySet: !!cfg.apiKey,
          partnerIdSet: !!cfg.partnerId,
          shortcodeSet: !!cfg.shortcode,
          provider: cfg.provider,
        },
        'SMS configuration is incomplete',
      );
      return false;
    }

    const payload = {
      apikey: cfg.apiKey,
      partnerID: cfg.partnerId,
      message,
      shortcode: cfg.shortcode,
      mobile: msisdn,
    };
    const useJson = cfg.apiUrl.includes('advantasms.com') || cfg.provider === 'advanta';

    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': useJson ? 'application/json' : 'application/x-www-form-urlencoded',
      },
      body: useJson
        ? JSON.stringify(payload)
        : new URLSearchParams({ ...payload, msisdn }).toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    const success = this.indicatesSuccess(res.status, body);

    this.log.info({ status: res.status, provider: cfg.provider, partnerId: cfg.partnerId, success, body: text.slice(0, 500) }, 'SMS provider response');
    if (!success) this.log.error({ status: res.status, phone: msisdn }, 'SMS provider rejected message');
    return success;
  }

  private indicatesSuccess(status: number, body: unknown): boolean {
    if (status < 200 || status >= 300) return false;
    if (!body || typeof body !== 'object') return true;
    const b = body as Record<string, any>;
    if ('success' in b) return Boolean(b.success);
    if (b.status === 'success') return true;
    const first = Array.isArray(b.responses) ? b.responses[0] : undefined;
    if (first?.['response-code'] !== undefined) return Number(first['response-code']) === 200;
    if (first?.['response-description'] !== undefined) {
      return String(first['response-description']).toLowerCase().includes('success');
    }
    if (b['response-code'] !== undefined) return Number(b['response-code']) === 200;
    return true;
  }
}
