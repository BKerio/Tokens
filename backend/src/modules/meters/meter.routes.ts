import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, MeterStatus, Role } from '../../shared/types/index.js';
import { resolveActor } from '../../shared/utils/actor.js';
import { optionalString, parse } from '../../shared/utils/validation.js';
import { MeterService } from './meter.service.js';

const stsField = z.coerce.number().int().nullable().optional();
const ownerId = z
  .union([z.string(), z.null()])
  .transform((v) => (v === '' ? null : v))
  .optional();

const createSchema = z.object({
  meterNumber: z.string().trim().min(1, 'Meter number is required'),
  type: z.string().trim().min(1, 'Meter type is required'),
  initialReading: z.coerce.number().min(0).optional(),
  status: z.enum(MeterStatus).optional(),
  vendorId: ownerId,
  landlordId: ownerId,
  sgc: stsField,
  krn: stsField,
  ti: stsField,
  ea: stsField,
  ken: stsField,
});

const updateSchema = createSchema.partial().extend({ pricePerUnit: z.coerce.number().min(0).optional() });

// Meter lists feed assignment pickers, so allow a large page.
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
  search: optionalString,
  status: z.enum(MeterStatus).optional(),
  vendorId: optionalString,
  landlordId: optionalString,
  unassigned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export async function meterRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new MeterService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole([...ADMIN_ROLES, Role.VENDOR, Role.LANDLORD]));
  const adminOnly = { preHandler: requireRole(ADMIN_ROLES) };

  app.get('/', async (req) => {
    const actor = await resolveActor(ctx.prisma, req.user);
    return { ok: true, ...(await service.list(actor, parse(listSchema, req.query))) };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const actor = await resolveActor(ctx.prisma, req.user);
    return { ok: true, data: await service.get(actor, req.params.id) };
  });

  app.post('/', adminOnly, async (req, reply) => {
    const meter = await service.create(parse(createSchema, req.body), req.user.userId);
    return reply.status(201).send({ ok: true, message: 'Meter created successfully', data: meter });
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const actor = await resolveActor(ctx.prisma, req.user);
    const meter = await service.update(actor, req.params.id, parse(updateSchema, req.body));
    return { ok: true, message: 'Meter updated successfully', data: meter };
  });

  app.delete<{ Params: { id: string } }>('/:id', adminOnly, async (req) => {
    await service.remove(req.params.id, req.user.userId);
    return { ok: true, message: 'Meter deleted successfully' };
  });
}
