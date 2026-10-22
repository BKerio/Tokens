import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../../context.js';
import { PaymentChannel } from '../../shared/types/index.js';
import { safeEqual } from '../../shared/utils/crypto.js';
import { NcbaPaymentService } from './ncba-payment.service.js';

/**
 * Port of the live Laravel `NcbaWebhookController`.
 *
 * NCBA must POST to: {APP_URL}/api/notifications/ncba
 *
 * Expected payload (JSON or form-urlencoded, key casing varies):
 * {
 *   "TransType": "Pay Bill",
 *   "TransID": "UDR7J243QA",
 *   "TransAmount": "40.0",
 *   "BusinessShortCode": "880100",
 *   "BillRefNumber": "218262",      // till
 *   "Narrative": "47500162848",     // meter number
 *   "Mobile": "254722127450",
 *   "name": "SAYED KOMAIL",
 *   "Username": "...",
 *   "Password": "..."
 * }
 *
 * Account format: TillNumber#MeterNumber. NCBA often sends the till in
 * BillRefNumber and the meter in Narrative.
 *
 * Differences from the PHP original, kept deliberately: credentials are
 * compared in constant time and never logged (PHP logs the whole payload,
 * password included), the amount must be a plain number, and a concurrent
 * retry of the same TransID is answered as a duplicate instead of a 500.
 */

const KEY_MAP: Record<string, string> = {
  transid: 'TransID',
  transamount: 'TransAmount',
  billrefnumber: 'BillRefNumber',
  narrative: 'Narrative',
  mobile: 'Mobile',
  msisdn: 'Mobile',
  username: 'Username',
  password: 'Password',
  hash: 'Hash',
  businessshortcode: 'BusinessShortCode',
  transtime: 'TransTime',
  transtype: 'TransType',
  name: 'name',
  firstname: 'name',
};

/** "40", "40.0", "1,500.00" - but never "abc", "-5" or "1e3". */
const AMOUNT_RE = /^\d{1,3}(,?\d{3})*(\.\d{1,2})?$/;

/** NCBA may send mixed field casing; map every key to the canonical name. */
export function normalizePayloadKeys(data: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[KEY_MAP[key.toLowerCase()] ?? key] = value === null || value === undefined ? '' : String(value);
  }
  return normalized;
}

/**
 * NCBA may send JSON, form-urlencoded, or a raw body. Like Laravel's
 * `$request->all()`, query-string fields are merged in (body wins).
 */
export function parsePayload(req: FastifyRequest): Record<string, string> {
  const query = (req.query ?? {}) as Record<string, unknown>;
  let body: unknown = req.body;

  if (typeof body === 'string') {
    const raw = body.trim();
    if (raw === '') {
      body = {};
    } else {
      try {
        body = JSON.parse(raw);
      } catch {
        const form = Object.fromEntries(new URLSearchParams(raw));
        if (Object.keys(form).length === 0) req.log.warn({ raw: raw.slice(0, 200) }, 'NCBA Webhook unparsed body');
        body = form;
      }
    }
  }

  const fields = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return normalizePayloadKeys({ ...query, ...fields });
}

/** What we log for a notification - never Username / Password / Hash. */
function logFields(d: Record<string, string>) {
  const mobile = d.Mobile ?? '';
  return {
    transType: d.TransType,
    transId: d.TransID,
    amount: d.TransAmount,
    billRef: d.BillRefNumber,
    narrative: d.Narrative,
    shortcode: d.BusinessShortCode,
    transTime: d.TransTime,
    mobile: mobile.length > 6 ? `${mobile.slice(0, 5)}***${mobile.slice(-3)}` : mobile ? '***' : undefined,
  };
}

export async function ncbaRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new NcbaPaymentService(ctx);

  /** Handle NCBA Paybill webhook notification. */
  async function handle(req: FastifyRequest, reply: FastifyReply) {
    const data = parsePayload(req);

    req.log.info(
      { ip: req.ip, method: req.method, contentType: req.headers['content-type'], userAgent: req.headers['user-agent'], ...logFields(data) },
      'NCBA Webhook received',
    );

    const expectedUsername = ctx.config.NCBA_PAYBILL_USERNAME;
    const expectedPassword = ctx.config.NCBA_PAYBILL_PASSWORD;
    const usernameMatch = !!expectedUsername && safeEqual(data.Username ?? '', expectedUsername);
    const passwordMatch = !!expectedPassword && safeEqual(data.Password ?? '', expectedPassword);

    if (!usernameMatch || !passwordMatch) {
      req.log.warn({ ip: req.ip, usernameMatch, passwordMatch, receivedKeys: Object.keys(data) }, 'NCBA Webhook authentication failed');
      return reply.status(401).send({ status: 'error', message: 'Unauthorized' });
    }

    const transID = data.TransID?.trim();
    const transAmount = data.TransAmount?.trim() ?? '';
    const mobile = data.Mobile?.trim();

    if (!transID || !transAmount || !mobile) {
      req.log.warn(logFields(data), 'NCBA Webhook missing required fields');
      return reply.status(422).send({ status: 'error', message: 'Missing required fields' });
    }

    const amount = AMOUNT_RE.test(transAmount) ? Number(transAmount.replace(/,/g, '')) : NaN;
    if (!(amount > 0)) {
      return reply.status(422).send({ status: 'error', message: 'Invalid transaction amount' });
    }

    const shortcode = data.BusinessShortCode?.trim();
    if (shortcode && shortcode !== ctx.config.NCBA_PAYBILL_SHORTCODE) {
      req.log.warn({ transID, shortcode, expected: ctx.config.NCBA_PAYBILL_SHORTCODE }, 'NCBA: payment for an unexpected paybill shortcode');
    }

    if (await service.isDuplicate(transID)) {
      req.log.info({ transID }, 'NCBA Webhook duplicate TransID ignored');
      return { status: 'duplicate_ignored' };
    }

    try {
      const result = await service.processPayment(
        {
          TransID: transID,
          TransAmount: amount,
          BillRefNumber: data.BillRefNumber ?? null,
          Narrative: data.Narrative ?? null,
          Mobile: mobile,
          name: data.name ?? null,
          BusinessShortCode: shortcode ?? null,
        },
        PaymentChannel.NCBA,
      );
      if (result.duplicate) return { status: 'duplicate_ignored' };

      req.log.info(result, 'NCBA Payment processed');
      return {
        status: 'success',
        message: 'Payment processed',
        token_generated: result.tokenGenerated,
        sms_sent: result.smsSent,
      };
    } catch (err) {
      req.log.error({ err, transID }, 'NCBA: Failed to process payment');
      return reply.status(500).send({ status: 'error', message: 'Failed to process transaction' });
    }
  }

  app.post('/ncba', handle);

  app.get('/ncba', async () => ({
    status: 'ok',
    message: 'TokenPap NCBA webhook endpoint is reachable',
    note: 'Payment notifications must be sent via POST',
  }));
}
