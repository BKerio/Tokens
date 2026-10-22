import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { Role, TokenType, TransactionStatus, VendMode } from '../../shared/types/index.js';
import { resolveActor } from '../../shared/utils/actor.js';
import { optionalString, paginationSchema, parse } from '../../shared/utils/validation.js';
import { TokenService } from './token.service.js';

const VENDING_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.VENDOR, Role.LANDLORD];

const lookupSchema = z.object({ q: z.string().trim().min(2, 'Enter at least 2 characters') });

const generateSchema = z.object({
  meterId: z.string().min(1),
  tokenType: z.enum(TokenType),
  vendMode: z.enum(VendMode).optional(),
  amount: z.coerce.number().min(0.01).optional(),
  externalTransactionId: optionalString,
  transactionTime: z.coerce.date().optional(),
  sendSms: z.boolean().optional(),
  phone: optionalString,
  controlValue: z.coerce.number().int().min(0).optional(),
});

const listSchema = paginationSchema.extend({
  meterId: optionalString,
  status: z.enum(TransactionStatus).optional(),
  tokenType: z.enum(TokenType).optional(),
  search: optionalString,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** /tokens - manual vending and transaction history (authenticated). */
export async function tokenRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new TokenService(ctx);
  app.addHook('preHandler', authenticate);

  app.get('/meter-lookup', { preHandler: requireRole(VENDING_ROLES) }, async (req) => {
    const { q } = parse(lookupSchema, req.query);
    const actor = await resolveActor(ctx.prisma, req.user);
    return { ok: true, data: await service.meterLookup(actor, q) };
  });

  app.post('/generate', { preHandler: requireRole(VENDING_ROLES) }, async (req, reply) => {
    const { meterId, ...input } = parse(generateSchema, req.body);
    const actor = await resolveActor(ctx.prisma, req.user);
    const result = await service.generate(actor, meterId, input);
    return reply.status(201).send({ ok: true, message: 'Token generated successfully', data: result });
  });

  // Every role can read history - the service scopes it to what the caller owns.
  app.get('/transactions', async (req) => {
    const filters = parse(listSchema, req.query);
    const actor = await resolveActor(ctx.prisma, req.user);
    return { ok: true, ...(await service.listTransactions(actor, filters)) };
  });
}

/** /public/tokens - unauthenticated "track my token" search. */
export async function publicTokenRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new TokenService(ctx);

  app.get(
    '/search',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { q } = parse(z.object({ q: z.string().trim().min(3, 'Enter a meter or phone number') }), req.query);
      return { ok: true, data: await service.publicSearch(q) };
    },
  );
}
