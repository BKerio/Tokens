import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, Role } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { optionalString, parse } from '../../shared/utils/validation.js';
import { can, landlordAccess } from '../rentals/access.js';
import { todayNairobi } from '../rentals/billing.js';
import { CollectionService, type CollectionScope } from './collection.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').transform((v) => new Date(`${v}T00:00:00Z`));

const listSchema = z.object({
  from: day.optional(),
  to: day.optional(),
  stream: z.enum(['RENT', 'ELECTRICITY', 'WATER', 'OTHER', 'UNASSIGNED']).optional(),
  // One status or a comma-separated list, e.g. MATCHED,VERIFIED,RESOLVED.
  status: z.string().optional().transform((v) => v?.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(['MATCHED', 'VERIFIED', 'RECORDED', 'EXCEPTION', 'RESOLVED', 'PENDING', 'FAILED'])).optional()),
  search: optionalString,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(5000).default(25),
});

type Params = { Params: { id: string } };

/**
 * /collections - money received (rent + token payments) and its
 * reconciliation. Admins see all; vendors their meters; landlords (and staff
 * with ledger / meter access) their rent and meters.
 */
export async function collectionRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new CollectionService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole([...ADMIN_ROLES, Role.VENDOR, Role.LANDLORD, Role.LANDLORD_STAFF]));

  const scopeOf = async (req: FastifyRequest): Promise<CollectionScope> => {
    const { userId, role } = req.user;
    if (ADMIN_ROLES.includes(role)) return { kind: 'ADMIN', userId };
    if (role === Role.VENDOR) {
      const vendor = await ctx.prisma.vendor.findUnique({ where: { userId }, select: { id: true } });
      if (!vendor) throw new NotFoundError('Vendor profile');
      return { kind: 'VENDOR', userId, vendorId: vendor.id };
    }
    const access = await landlordAccess(ctx, req);
    if (!can(access, 'ledger.view') && !can(access, 'meters.view')) throw new ForbiddenError('You do not have access to collections.');
    return { kind: 'LANDLORD', userId, access };
  };

  app.get('/', async (req) => {
    const q = parse(listSchema, req.query);
    const to = q.to ?? todayNairobi();
    const from = q.from ?? new Date(to.getTime() - 29 * 86_400_000);
    return { ok: true, ...(await service.list(await scopeOf(req), { ...q, from, to })) };
  });

  app.get('/leases', async (req) => {
    const { search } = parse(z.object({ search: optionalString }), req.query);
    return { ok: true, data: await service.searchLeases(await scopeOf(req), search) };
  });

  app.post<Params>('/payments/:id/allocate-rent', async (req) => {
    const { leaseId, note } = parse(z.object({ leaseId: z.string().min(1), note: optionalString }), req.body);
    const entry = await service.allocateToRent(await scopeOf(req), req.params.id, leaseId, note);
    return { ok: true, message: 'Payment allocated to the lease as rent', data: entry };
  });

  app.post<Params>('/payments/:id/vend', async (req) => {
    const { meterNumber } = parse(z.object({ meterNumber: z.string().trim().min(4, 'Enter the meter number') }), req.body);
    const result = await service.vendToMeter(await scopeOf(req), req.params.id, meterNumber);
    return { ok: true, message: 'Token issued and sent', data: result };
  });

  app.post<Params>('/payments/:id/resolve', async (req) => {
    const { resolution, note } = parse(z.object({
      resolution: z.enum(['REFUNDED', 'WRITTEN_OFF']),
      note: z.string().trim().min(3, 'Add a short note').max(300),
    }), req.body);
    await service.resolve(await scopeOf(req), req.params.id, resolution, note);
    return { ok: true, message: resolution === 'REFUNDED' ? 'Marked as refunded' : 'Marked as written off' };
  });
}
