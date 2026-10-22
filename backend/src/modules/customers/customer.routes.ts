import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, RecordStatus, Role } from '../../shared/types/index.js';
import { resolveActor } from '../../shared/utils/actor.js';
import { nullableString, optionalString, paginationSchema, parse } from '../../shared/utils/validation.js';
import { CustomerService } from './customer.service.js';

const locationId = z.coerce.number().int().positive().nullable().optional();

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(255),
  phone: z.string().trim().min(9, 'Phone is required'),
  email: z.union([z.string().trim().email('Invalid email address'), z.literal(''), z.null()]).transform((v) => v || null).optional(),
  address: nullableString,
  meterId: z.string().min(1, 'Select a meter'),
  vendorId: optionalString,
  countyId: locationId,
  constituencyId: locationId,
  wardId: locationId,
  status: z.enum(RecordStatus).optional(),
});

const updateSchema = createSchema.partial();

const listSchema = paginationSchema.extend({ search: optionalString, vendorId: optionalString });

export async function customerRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new CustomerService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole([...ADMIN_ROLES, Role.VENDOR]));

  app.get('/', async (req) => {
    const actor = await resolveActor(ctx.prisma, req.user);
    return { ok: true, ...(await service.list(actor, parse(listSchema, req.query))) };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const actor = await resolveActor(ctx.prisma, req.user);
    return { ok: true, data: await service.get(actor, req.params.id) };
  });

  app.post('/', async (req, reply) => {
    const actor = await resolveActor(ctx.prisma, req.user);
    const customer = await service.create(actor, parse(createSchema, req.body));
    return reply.status(201).send({ ok: true, message: 'Customer created successfully', data: customer });
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const actor = await resolveActor(ctx.prisma, req.user);
    const customer = await service.update(actor, req.params.id, parse(updateSchema, req.body));
    return { ok: true, message: 'Customer updated successfully', data: customer };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const actor = await resolveActor(ctx.prisma, req.user);
    await service.remove(actor, req.params.id);
    return { ok: true, message: 'Customer deleted successfully' };
  });
}
