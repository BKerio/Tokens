import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { PropertyType, RecordStatus, UnitOccupancy } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { nullableString, optionalString, parse } from '../../shared/utils/validation.js';
import { LANDLORD_ORG_ROLES, assertCan, assertProperty, landlordAccess, type LandlordPermission } from '../rentals/access.js';
import { OrgService } from '../rentals/org.service.js';
import { PropertyService } from './property.service.js';

const regionId = z.union([z.coerce.number().int().positive(), z.null()]).optional();

const propertySchema = z.object({
  name: z.string().trim().min(1, 'Property name is required').max(255),
  propertyType: z.enum(PropertyType),
  noOfUnits: z.coerce.number().int().min(1, 'At least 1 unit').max(500, 'At most 500 units'),
  location: z.string().trim().min(1, 'Street address is required').max(500),
  status: z.enum(RecordStatus).optional(),
  locationId: z.union([z.string().min(1), z.null()]).optional(),
  countyId: regionId,
  constituencyId: regionId,
  wardId: regionId,
});

/** A new property must name its county. */
const createPropertySchema = propertySchema.extend({ countyId: z.coerce.number({ message: 'Choose the county' }).int().positive('Choose the county') });

const meterRef = z.union([z.string().min(1), z.null()]).optional();

const rentField = z.union([z.coerce.number().min(0).max(100_000_000), z.null()]).optional();

/** A unit's payment account: one of the configured accounts. A paybill's account no. may be blank (tenants use their lease code). */
const paymentAccountSchema = z.object({
  source: z.string().trim().min(1, 'Choose a payment account').max(60),
  account: z.string().trim().max(40).nullable().optional(),
  accountName: z.string().trim().max(120).nullable().optional(),
});

const unitFields = {
  unitNumber: nullableString,
  status: z.enum(RecordStatus).optional(),
  monthlyRent: rentField,
  depositAmount: rentField,
  payment: z.union([paymentAccountSchema, z.null()]).optional(),
};

const unitSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(1, 'Unit name is required').max(255),
  meterId: meterRef,
  ...unitFields,
});

const unitUpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  ...unitFields,
  occupancy: z.enum(UnitOccupancy).optional(),
  occupancyNote: z.union([z.string().trim().max(300), z.null()]).transform((v) => v || null).optional(),
  tenantIds: z.array(z.string().min(1)).max(20).optional(),
  customerIds: z.array(z.string().min(1)).max(20).optional(),
});

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Customer name is required').max(255),
  phone: z.string().trim().min(9, 'Phone is required').max(30),
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).transform((v) => v || null).optional(),
  unitId: z.union([z.string().min(1), z.null()]).optional(),
  status: z.enum(RecordStatus).optional(),
});

const bulkUnitsSchema = z.object({
  count: z.coerce.number().int().min(1).max(200),
  namePrefix: z.string().trim().min(1).max(100),
  startNumber: z.coerce.number().int().min(1).optional(),
});

const applyPaymentSchema = z.object({ payment: paymentAccountSchema, onlyMissing: z.boolean().optional() });

const unitMetersSchema = z.object({
  assignments: z.array(z.object({ unitId: z.string().min(1), meterId: meterRef })).min(1),
});

const tenantSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(1, 'Tenant name is required').max(255),
  phone: z.string().trim().min(9, 'Phone is required').max(30),
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).transform((v) => v || null).optional(),
  idNumber: nullableString,
  unitId: z.union([z.string().min(1), z.null()]).optional(),
  status: z.enum(RecordStatus).optional(),
});

const tenantUpdateSchema = tenantSchema.partial();

type Params = { Params: { id: string } };

/**
 * /landlord - properties, their units (rent defaults, payment account, meter)
 * and tenants. Open to the landlord (owner) and their staff; every call checks the
 * staff member's permission and property scope.
 */
export async function propertyRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new PropertyService(ctx);
  const org = new OrgService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(LANDLORD_ORG_ROLES));

  /** Landlord + actor for this request after checking `permission` (and the property, when known). */
  const who = async (req: FastifyRequest, permission: LandlordPermission, propertyId?: string | null) => {
    const access = await landlordAccess(ctx, req);
    assertCan(access, permission);
    if (propertyId) assertProperty(access, propertyId);
    return { landlordId: access.landlordId, actorId: access.actorId, access };
  };

  /** Creating or deleting whole properties needs access to all of them (owner, or an all-properties manager). */
  const whoForPortfolio = async (req: FastifyRequest) => {
    const w = await who(req, 'properties.manage');
    if (!w.access.allProperties) throw new ForbiddenError('Only staff with access to all properties can add or delete properties.');
    return w;
  };

  /** propertyId of a unit / tenant, for scope checks on id-addressed routes. */
  const propertyOf = async (kind: 'unit' | 'tenant', id: string) => {
    const select = { propertyId: true } as const;
    const row = kind === 'unit'
      ? await ctx.prisma.propertyUnit.findUnique({ where: { id }, select })
      : await ctx.prisma.landlordTenant.findUnique({ where: { id }, select });
    if (!row) throw new NotFoundError(kind[0]!.toUpperCase() + kind.slice(1));
    return row.propertyId;
  };

  // ── Properties ─────────────────────────────────────────────────────────────
  app.get('/properties', async (req) => {
    const { landlordId, access } = await who(req, 'properties.view');
    const { search, locationId } = parse(z.object({ search: optionalString, locationId: optionalString }), req.query);
    return { ok: true, data: await service.list(landlordId, search, access.allProperties ? undefined : access.propertyIds, locationId) };
  });

  app.get<Params>('/properties/:id', async (req) => {
    const { landlordId } = await who(req, 'properties.view', req.params.id);
    return { ok: true, data: await service.get(landlordId, req.params.id) };
  });

  app.post('/properties', async (req, reply) => {
    const { landlordId, actorId } = await whoForPortfolio(req);
    const input = parse(createPropertySchema, req.body);
    await org.assertLocation(landlordId, input.locationId);
    const property = await service.create(landlordId, actorId, input);
    return reply.status(201).send({ ok: true, message: 'Property added successfully', data: property });
  });

  app.patch<Params>('/properties/:id', async (req) => {
    const { landlordId, actorId } = await who(req, 'properties.manage', req.params.id);
    const input = parse(propertySchema.partial(), req.body);
    await org.assertLocation(landlordId, input.locationId);
    const property = await service.update(landlordId, actorId, req.params.id, input);
    return { ok: true, message: 'Property updated successfully', data: property };
  });

  app.delete<Params>('/properties/:id', async (req) => {
    const { landlordId, actorId } = await whoForPortfolio(req);
    await service.remove(landlordId, actorId, req.params.id);
    return { ok: true, message: 'Property deleted successfully' };
  });

  app.get<Params>('/properties/:id/units', async (req) => {
    const { landlordId } = await who(req, 'properties.view', req.params.id);
    return { ok: true, data: await service.detail(landlordId, req.params.id) };
  });

  // ── Units ──────────────────────────────────────────────────────────────────
  app.post('/units', async (req, reply) => {
    const input = parse(unitSchema, req.body);
    const { landlordId, actorId } = await who(req, 'properties.manage', input.propertyId);
    return reply.status(201).send({ ok: true, data: await service.createUnit(landlordId, actorId, input) });
  });

  app.post<Params>('/properties/:id/units/bulk', async (req, reply) => {
    const { landlordId, actorId } = await who(req, 'properties.manage', req.params.id);
    const units = await service.createUnitsBulk(landlordId, actorId, req.params.id, parse(bulkUnitsSchema, req.body));
    return reply.status(201).send({ ok: true, message: `${units.length} units created successfully`, data: units });
  });

  app.get('/payment-sources', async (req) => {
    const { landlordId } = await who(req, 'properties.view');
    return { ok: true, data: await service.paymentSources(landlordId) };
  });

  app.put<Params>('/properties/:id/payment-account', async (req) => {
    const { landlordId, actorId } = await who(req, 'properties.manage', req.params.id);
    const { payment, onlyMissing } = parse(applyPaymentSchema, req.body);
    const result = await service.applyPaymentAccount(landlordId, actorId, req.params.id, payment, onlyMissing ?? false);
    return { ok: true, message: `Payment account set on ${result.updated} unit(s)`, data: result };
  });

  app.put<Params>('/properties/:id/unit-meters', async (req) => {
    const { landlordId, actorId } = await who(req, 'properties.manage', req.params.id);
    const { assignments } = parse(unitMetersSchema, req.body);
    return { ok: true, message: 'Meter assignments saved', data: await service.syncUnitMeters(landlordId, actorId, req.params.id, assignments) };
  });

  app.patch<Params>('/units/:id', async (req) => {
    const propertyId = await propertyOf('unit', req.params.id);
    const { landlordId, actorId, access } = await who(req, 'properties.manage', propertyId);
    const input = parse(unitUpdateSchema, req.body);
    if (input.tenantIds || input.customerIds) assertCan(access, 'tenants.manage');
    return { ok: true, data: await service.updateUnit(landlordId, actorId, req.params.id, input) };
  });

  app.put<Params>('/units/:id/meter', async (req) => {
    const { landlordId, actorId } = await who(req, 'properties.manage', await propertyOf('unit', req.params.id));
    const { meterId } = parse(z.object({ meterId: z.string().min(1).nullable() }), req.body);
    const unit = await service.assignUnitMeter(landlordId, actorId, req.params.id, meterId);
    return { ok: true, message: meterId ? 'Meter linked to unit successfully' : 'Meter unlinked from unit', data: unit };
  });

  app.delete<Params>('/units/:id', async (req) => {
    const { landlordId, actorId } = await who(req, 'properties.manage', await propertyOf('unit', req.params.id));
    await service.removeUnit(landlordId, actorId, req.params.id);
    return { ok: true, message: 'Unit deleted' };
  });

  // ── Customers (token buyers living in the landlord's units) ───────────────
  app.get('/customers', async (req) => {
    const { landlordId, access } = await who(req, 'tenants.view');
    return { ok: true, data: await service.listCustomers(landlordId, access.allProperties ? undefined : access.propertyIds) };
  });

  app.post('/customers', async (req, reply) => {
    const input = parse(customerSchema, req.body);
    const access = await landlordAccess(ctx, req);
    const { landlordId, actorId } = await who(req, 'tenants.manage', await service.unitProperty(access.landlordId, input.unitId));
    if (!input.unitId && !access.allProperties) throw new ForbiddenError('Link the customer to one of your units.');
    return reply.status(201).send({ ok: true, message: 'Customer added', data: await service.createCustomer(landlordId, actorId, input) });
  });

  app.patch<Params>('/customers/:id', async (req) => {
    const input = parse(customerSchema.partial(), req.body);
    const access = await landlordAccess(ctx, req);
    await who(req, 'tenants.manage', await service.customerProperty(access.landlordId, req.params.id));
    const { landlordId, actorId } = await who(req, 'tenants.manage', await service.unitProperty(access.landlordId, input.unitId));
    return { ok: true, data: await service.updateCustomer(landlordId, actorId, req.params.id, input) };
  });

  app.delete<Params>('/customers/:id', async (req) => {
    const access = await landlordAccess(ctx, req);
    const { landlordId, actorId } = await who(req, 'tenants.manage', await service.customerProperty(access.landlordId, req.params.id));
    await service.removeCustomer(landlordId, actorId, req.params.id);
    return { ok: true, message: 'Customer removed' };
  });

  // ── Tenants ────────────────────────────────────────────────────────────────
  app.get('/tenants', async (req) => {
    const { propertyId } = parse(z.object({ propertyId: optionalString }), req.query);
    const { landlordId, access } = await who(req, 'tenants.view', propertyId);
    return { ok: true, data: await service.listTenants(landlordId, propertyId, access.allProperties ? undefined : access.propertyIds) };
  });

  app.post('/tenants', async (req, reply) => {
    const input = parse(tenantSchema, req.body);
    const { landlordId, actorId } = await who(req, 'tenants.manage', input.propertyId);
    return reply.status(201).send({ ok: true, data: await service.createTenant(landlordId, actorId, input) });
  });

  app.patch<Params>('/tenants/:id', async (req) => {
    const input = parse(tenantUpdateSchema, req.body);
    const { landlordId, actorId } = await who(req, 'tenants.manage', await propertyOf('tenant', req.params.id));
    if (input.propertyId) await who(req, 'tenants.manage', input.propertyId);
    return { ok: true, data: await service.updateTenant(landlordId, actorId, req.params.id, input) };
  });

  app.delete<Params>('/tenants/:id', async (req) => {
    const { landlordId, actorId } = await who(req, 'tenants.manage', await propertyOf('tenant', req.params.id));
    await service.removeTenant(landlordId, actorId, req.params.id);
    return { ok: true, message: 'Tenant removed' };
  });
}
