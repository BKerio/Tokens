import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { normalizeMsisdn } from '../../shared/utils/phone.js';
import { parse } from '../../shared/utils/validation.js';
import { MpesaPaymentService } from './mpesa.service.js';

const stkSchema = z.object({
  phone: z.string().trim().refine((v) => !!normalizeMsisdn(v), 'Enter a valid Safaricom phone number'),
  amount: z.coerce.number().min(1, 'Minimum amount is KES 1'),
  reference: z.string().trim().max(50).optional(),
});

/**
 * M-Pesa endpoints, mounted at /api/mpesa. The callback and C2B paths are the
 * same as the legacy Laravel API so URLs already registered with Safaricom
 * keep working, and they answer in the shape Safaricom expects rather than the
 * usual { ok, data } envelope.
 */
export async function mpesaRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new MpesaPaymentService(ctx);

  // ── STK push (M-Pesa Express) ─────────────────────────────────────────────
  app.post('/stkpush', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const input = parse(stkSchema, req.body);
    return { ok: true, data: await service.stkPush(input) };
  });

  app.post('/callback', async (req) => {
    try {
      await service.handleStkCallback(req.body);
    } catch (err) {
      req.log.error({ err }, 'Failed to process STK callback');
    }
    return { ResultCode: 0, ResultDesc: 'Success' };
  });

  app.get<{ Params: { checkoutRequestId: string }; Querystring: { wait?: string } }>('/query/:checkoutRequestId', async (req) => {
    const wait = ['1', 'true'].includes(String(req.query.wait ?? ''));
    return { ok: true, data: await service.checkStatus(req.params.checkoutRequestId, wait) };
  });

  // ── C2B paybill ───────────────────────────────────────────────────────────
  app.post('/c2b/validation', async (req) => {
    req.log.info({ payload: req.body }, 'M-Pesa C2B validation received');
    return { ResultCode: '0', ResultDesc: 'Accepted' };
  });

  app.post('/c2b/confirmation', async (req) => {
    const data = (req.body ?? {}) as Record<string, unknown>;
    req.log.info({ payload: data }, 'M-Pesa C2B confirmation received');
    try {
      const result = await service.handleC2bConfirmation(data);
      if (!result) return { ResultCode: 'C2B00016', ResultDesc: 'Missing required fields' };
      if (result.duplicate) return { ResultCode: '0', ResultDesc: 'Duplicate ignored' };
      req.log.info(result, 'M-Pesa C2B payment processed');
    } catch (err) {
      req.log.error({ err, transId: data.TransID }, 'M-Pesa C2B processing failed');
    }
    return { ResultCode: '0', ResultDesc: 'Success' };
  });

  app.get('/c2b/validation', async () => ({ status: 'ok', endpoint: 'C2B validation - POST required' }));
  app.get('/c2b/confirmation', async () => ({ status: 'ok', endpoint: 'C2B confirmation - POST required' }));
}
