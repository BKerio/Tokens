import type { Logger } from '../../lib/logger.js';
import { MpesaEnv, MpesaTransactionType } from '../../shared/types/index.js';
import { normalizeMsisdn } from '../../shared/utils/phone.js';

/** Fully-resolved Daraja credentials for one STK push (secrets decrypted). */
export interface DarajaCredentials {
  env: MpesaEnv;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  tillNo?: string | null;
  callbackUrl: string;
  transactionType: MpesaTransactionType;
}

/** Raw Daraja response - success has CheckoutRequestID, failure errorCode/errorMessage. */
export type DarajaResponse = Record<string, any>;

const DARAJA_TYPE: Record<MpesaTransactionType, string> = {
  CUSTOMER_PAYBILL_ONLINE: 'CustomerPayBillOnline',
  CUSTOMER_BUYGOODS_ONLINE: 'CustomerBuyGoodsOnline',
};

export function darajaBaseUrl(env: MpesaEnv): string {
  return env === MpesaEnv.LIVE ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

/** Parses the legacy string forms ("CustomerPayBillOnline", "live") into enums. */
export function parseTransactionType(raw: unknown): MpesaTransactionType {
  return String(raw ?? '').toLowerCase().includes('paybill')
    ? MpesaTransactionType.CUSTOMER_PAYBILL_ONLINE
    : MpesaTransactionType.CUSTOMER_BUYGOODS_ONLINE;
}

export function parseMpesaEnv(raw: unknown): MpesaEnv {
  return String(raw ?? '').toLowerCase() === 'live' ? MpesaEnv.LIVE : MpesaEnv.SANDBOX;
}

/** First credential the STK push can't go without, or null when complete. */
export function firstMissingDarajaField(c: Partial<DarajaCredentials>): string | null {
  const required: (keyof DarajaCredentials)[] = ['consumerKey', 'consumerSecret', 'passkey', 'shortcode'];
  if ((c.transactionType ?? MpesaTransactionType.CUSTOMER_BUYGOODS_ONLINE) === MpesaTransactionType.CUSTOMER_BUYGOODS_ONLINE) {
    required.push('tillNo');
  }
  return required.find((f) => !c[f]) ?? null;
}

/** "YYYYMMDDHHmmss" in Nairobi time, as Daraja expects. */
function darajaTimestamp(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour') === '24' ? '00' : get('hour')}${get('minute')}${get('second')}`;
}

/** Safaricom Daraja client: OAuth, STK push (M-Pesa Express), C2B URL registration. */
export class DarajaClient {
  constructor(private log: Logger) {}

  private async accessToken(env: MpesaEnv, key: string, secret: string): Promise<{ token?: string; error?: DarajaResponse }> {
    const auth = Buffer.from(`${key.trim()}:${secret.trim()}`).toString('base64');
    const res = await fetch(`${darajaBaseUrl(env)}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as DarajaResponse | null;
    if (!res.ok || !body?.access_token) {
      this.log.error({ status: res.status, body }, 'Failed to generate M-Pesa access token');
      return { error: body ?? { errorMessage: 'Failed to generate access token' } };
    }
    return { token: body.access_token as string };
  }

  async stkPush(creds: DarajaCredentials, phone: string, amount: number, reference: string): Promise<DarajaResponse> {
    try {
      const msisdn = normalizeMsisdn(phone) ?? phone.replace(/\D/g, '');
      const { token, error } = await this.accessToken(creds.env, creds.consumerKey, creds.consumerSecret);
      if (!token) return error!;

      const timestamp = darajaTimestamp();
      const password = Buffer.from(`${creds.shortcode}${creds.passkey}${timestamp}`).toString('base64');
      const isPaybill = creds.transactionType === MpesaTransactionType.CUSTOMER_PAYBILL_ONLINE;
      const ref = reference.slice(0, 12);

      const payload = {
        BusinessShortCode: creds.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: DARAJA_TYPE[creds.transactionType],
        Amount: Math.floor(amount),
        PartyA: msisdn,
        PartyB: isPaybill ? creds.shortcode : creds.tillNo,
        PhoneNumber: msisdn,
        CallBackURL: creds.callbackUrl,
        AccountReference: ref,
        TransactionDesc: ref,
      };

      this.log.info({ env: creds.env, callbackUrl: creds.callbackUrl, reference: ref }, 'Sending STK push');
      const res = await fetch(`${darajaBaseUrl(creds.env)}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => null)) as DarajaResponse | null;
      if (!res.ok) this.log.error({ status: res.status, body }, 'STK push request failed');
      return body ?? { errorMessage: 'Empty or invalid response from M-Pesa API', status: res.status };
    } catch (err) {
      this.log.error({ err }, 'STK push error');
      return { errorMessage: err instanceof Error ? err.message : 'M-Pesa request failed' };
    }
  }

  /**
   * STK Push Query: asks Daraja for the outcome of a push whose callback hasn't
   * arrived. Settled pushes come back with ResultCode; one still on the payer's
   * phone comes back as errorCode 500.001.1001 "The transaction is being processed".
   */
  async stkQuery(creds: DarajaCredentials, checkoutRequestId: string): Promise<DarajaResponse> {
    try {
      const { token, error } = await this.accessToken(creds.env, creds.consumerKey, creds.consumerSecret);
      if (!token) return error!;
      const timestamp = darajaTimestamp();
      const res = await fetch(`${darajaBaseUrl(creds.env)}/mpesa/stkpushquery/v1/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          BusinessShortCode: creds.shortcode,
          Password: Buffer.from(`${creds.shortcode}${creds.passkey}${timestamp}`).toString('base64'),
          Timestamp: timestamp,
          CheckoutRequestID: checkoutRequestId,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      return ((await res.json().catch(() => null)) as DarajaResponse | null) ?? { errorMessage: 'Empty response', status: res.status };
    } catch (err) {
      this.log.error({ err, checkoutRequestId }, 'STK query error');
      return { errorMessage: err instanceof Error ? err.message : 'M-Pesa query failed' };
    }
  }

  /** True when a Daraja response signals the push was not accepted. */
  static isError(res: DarajaResponse): boolean {
    return !!(res.errorCode || res.errorMessage || (res.ResponseCode !== undefined && String(res.ResponseCode) !== '0'));
  }

  static errorMessage(res: DarajaResponse): string {
    return res.errorMessage ?? res.CustomerMessage ?? res.customerMessage ?? res.ResponseDescription ?? 'M-Pesa API Error';
  }

  /** Registers C2B validation/confirmation URLs for a paybill shortcode. */
  async registerC2bUrls(
    creds: Pick<DarajaCredentials, 'env' | 'consumerKey' | 'consumerSecret'>,
    shortCode: string,
    confirmationUrl: string,
    validationUrl: string,
  ): Promise<DarajaResponse> {
    const { token, error } = await this.accessToken(creds.env, creds.consumerKey, creds.consumerSecret);
    if (!token) return error!;
    const payload = { ShortCode: shortCode, ResponseType: 'Completed', ConfirmationURL: confirmationUrl, ValidationURL: validationUrl };
    this.log.info(payload, 'Registering M-Pesa C2B URLs');
    const res = await fetch(`${darajaBaseUrl(creds.env)}/mpesa/c2b/v1/registerurl`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    return ((await res.json().catch(() => null)) as DarajaResponse | null) ?? { errorMessage: 'Empty response', status: res.status };
  }
}
