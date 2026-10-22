import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { AdminService } from './admin.service.js';
import { PrismTestService } from '../tokens/prism-test.service.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, AccountStatus, Role } from '../../shared/types/index.js';
import { nullableString, optionalString, paginationSchema, parse } from '../../shared/utils/validation.js';

const operatorRole = z.enum([Role.SUPER_ADMIN, Role.ADMIN]);

const createSchema = z.object({
  name: z.string().trim().min(2),
  username: z.string().trim().min(3),
  email: z.string().trim().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: operatorRole,
  phone: optionalString,
});

const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  username: z.string().trim().min(3).optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  phone: nullableString,
  role: operatorRole.optional(),
  status: z.enum([AccountStatus.ACTIVE, AccountStatus.SUSPENDED]).optional(),
});

const listSchema = paginationSchema.extend({ role: operatorRole.optional(), search: optionalString });

const prismTestSchema = z
  .object({
    meterNumber: z.string().trim().regex(/^\d{6,20}$/, 'Meter number must be 6-20 digits'),
    amount: z.coerce.number().positive('Amount must be greater than 0').max(100_000).optional(),
    control: z.enum(['CLEAR_TAMPER', 'CLEAR_CREDIT', 'SET_MAX_OVERDRAFT']).optional(),
    value: z.coerce.number().int().min(0).optional(),
    raw: z.boolean().optional(),
  })
  .refine((d) => d.control || d.amount !== undefined, { message: 'Enter an amount for a credit token', path: ['amount'] });

const auditSchema = paginationSchema.extend({
  userId: optionalString,
  action: optionalString,
  subjectType: optionalString,
  from: optionalString,
  to: optionalString,
});

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new AdminService(ctx);

  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(ADMIN_ROLES));

  app.get('/stats', async () => ({ ok: true, data: await service.stats() }));

  /**
   * Prism diagnostic (the `npm run prism:test` engine): issues a REAL token on
   * the Prism network for the given meter and reports each step. Records no
   * transaction and sends no SMS, but every run is audit-logged.
   */
  app.post('/prism-test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const input = parse(prismTestSchema, req.body);
    const result = await new PrismTestService(ctx).run(input);
    await ctx.auditLog.record({
      actorId: req.user.userId,
      action: 'VEND',
      subjectType: 'TOKEN',
      subjectId: result.messageId ?? `prism-test:${input.meterNumber}`,
      summary: `Prism test ${result.ok ? 'succeeded' : 'failed'}: ${result.tokenType === 'CREDIT' ? `credit ${result.amount}` : result.tokenType} for meter ${input.meterNumber}${result.error ? ` - ${result.error.message}` : ''}`,
      newValues: { ok: result.ok, source: result.source, sts: result.sts, error: result.error, tokens: result.tokens.length },
    });
    return { ok: true, data: result };
  });

  app.get('/users', async (req) => {
    const filters = parse(listSchema, req.query);
    return { ok: true, ...(await service.listOperators(filters)) };
  });

  app.post('/users', async (req, reply) => {
    const data = parse(createSchema, req.body);
    const user = await service.createOperator(data, req.user);
    return reply.status(201).send({ ok: true, data: user });
  });

  app.patch<{ Params: { id: string } }>('/users/:id', async (req) => {
    const data = parse(updateSchema, req.body);
    return { ok: true, data: await service.updateOperator(req.params.id, data, req.user) };
  });

  app.delete<{ Params: { id: string } }>('/users/:id', async (req) => {
    await service.deleteOperator(req.params.id, req.user);
    return { ok: true };
  });

  /** The system-wide activity trail - every mutation writes here via AuditLogService.record(). */
  app.get('/audit-logs', async (req) => {
    const q = parse(auditSchema, req.query);
    return { ok: true, ...(await ctx.auditLog.list(q)) };
  });
}
