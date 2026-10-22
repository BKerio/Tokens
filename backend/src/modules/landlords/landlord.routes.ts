import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, AccountStatus } from '../../shared/types/index.js';
import { optionalString, paginationSchema, parse } from '../../shared/utils/validation.js';
import { LandlordService } from './landlord.service.js';
import { LANDLORD_ORG_ROLES, assertCan, landlordAccess, type LandlordPermission } from '../rentals/access.js';
import { PropertyService } from '../properties/property.service.js';

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: z.string().trim().email('Invalid email address'),
  username: z.string().trim().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().trim().min(9, 'Phone is required').max(20),
  paymentAccount: z.string().trim().min(1, 'Payment account is required').max(255),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum([AccountStatus.ACTIVE, AccountStatus.SUSPENDED]).optional(),
});

const listSchema = paginationSchema.extend({ search: optionalString });

/** /landlords - admin landlord management. */
export async function landlordAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new LandlordService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(ADMIN_ROLES));

  app.get('/', async (req) => ({ ok: true, ...(await service.list(parse(listSchema, req.query))) }));

  app.get<{ Params: { id: string } }>('/:id', async (req) => ({ ok: true, data: await service.get(req.params.id) }));

  app.post('/', async (req, reply) => {
    const landlord = await service.create(parse(createSchema, req.body), req.user.userId);
    return reply.status(201).send({ ok: true, message: 'Landlord registered successfully', data: landlord });
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const landlord = await service.update(req.params.id, parse(updateSchema, req.body), req.user.userId);
    return { ok: true, message: 'Landlord updated successfully', data: landlord };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    await service.remove(req.params.id, req.user.userId);
    return { ok: true, message: 'Landlord removed successfully' };
  });

  app.get<{ Params: { id: string } }>('/:id/meters', async (req) => ({ ok: true, data: await service.meters(req.params.id) }));

  app.put<{ Params: { id: string } }>('/:id/meters', async (req) => {
    const { meterIds } = parse(z.object({ meterIds: z.array(z.string()) }), req.body);
    return { ok: true, message: 'Meter assignments updated successfully', data: await service.syncMeters(req.params.id, meterIds, req.user.userId) };
  });

  // Read-only oversight of a landlord's properties and their units.
  const properties = new PropertyService(ctx);

  app.get<{ Params: { id: string } }>('/:id/properties', async (req) => {
    const { search } = parse(z.object({ search: optionalString }), req.query);
    return { ok: true, data: await properties.list(req.params.id, search) };
  });

  app.get<{ Params: { id: string; propertyId: string } }>('/:id/properties/:propertyId/units', async (req) => ({
    ok: true,
    data: await properties.detail(req.params.id, req.params.propertyId),
  }));
}

/** /landlord - the signed-in landlord's own dashboard data. */
export async function landlordSelfRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new LandlordService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(LANDLORD_ORG_ROLES));

  /** The landlord this owner/staff member works for, after a permission check. */
  const landlordId = async (req: Parameters<typeof authenticate>[0], permission: LandlordPermission) => {
    const access = await landlordAccess(ctx, req);
    assertCan(access, permission);
    return access.landlordId;
  };

  app.get('/dashboard', async (req) => ({ ok: true, data: await service.dashboard(await landlordId(req, 'properties.view')) }));
  app.get('/meters', async (req) => ({ ok: true, data: await service.meters(await landlordId(req, 'meters.view')) }));
}
