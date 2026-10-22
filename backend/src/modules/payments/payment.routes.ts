import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, PaymentChannel, PaymentStatus } from '../../shared/types/index.js';
import { normalizeMsisdn } from '../../shared/utils/phone.js';
import { optionalString, paginationSchema, parse } from '../../shared/utils/validation.js';
import { NcbaPaymentService } from '../ncba/ncba-payment.service.js';
import { PaymentService } from './payment.service.js';

const listSchema = paginationSchema.extend({
  status: z.enum(PaymentStatus).optional(),
  channel: z.enum(PaymentChannel).optional(),
  search: optionalString,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const replaySchema = z.object({
  transId: z.string().trim().min(6, 'Enter the M-Pesa / NCBA transaction ID').max(40).transform((v) => v.toUpperCase()),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  phone: z.string().trim().refine((v) => !!normalizeMsisdn(v), 'Enter a valid Safaricom phone number'),
  meterNumber: z.string().trim().min(1, 'Meter number is required'),
  till: optionalString,
  name: optionalString,
});

const revendSchema = z.object({ meterNumber: optionalString });

/** /api/payments - admin ledger and token recovery across all channels. */
export async function paymentRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new PaymentService(ctx);
  const ncba = new NcbaPaymentService(ctx);

  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(ADMIN_ROLES));

  app.get('/', async (req) => {
    const filters = parse(listSchema, req.query);
    return { ok: true, ...(await service.list(filters)) };
  });

  /** Records + vends an NCBA payment that never arrived by webhook (confirm it on the NCBA statement first). */
  app.post('/ncba/replay', async (req, reply) => {
    const input = parse(replaySchema, req.body);
    const result = await ncba.processManualPayment(input, req.user.userId);
    return reply.status(201).send({ ok: true, data: result });
  });

  /** Retries the token for a confirmed payment, optionally against a corrected meter number. */
  app.post<{ Params: { id: string } }>('/:id/revend', async (req) => {
    const { meterNumber } = parse(revendSchema, req.body ?? {});
    return { ok: true, data: await service.revendPayment(req.params.id, req.user.userId, meterNumber) };
  });
}
