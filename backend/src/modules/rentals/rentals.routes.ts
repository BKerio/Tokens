import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { BillingFrequency, LandlordStaffRole, LeaseStatus, LedgerEntryType, PaymentMethod, RentClaimPurpose, RentClaimStatus } from '../../generated/prisma/index.js';
import { nullableString, optionalString, paginationSchema, parse } from '../../shared/utils/validation.js';
import { LANDLORD_ORG_ROLES, assertCan, describeAccess, landlordAccess } from './access.js';
import { parseDay, todayNairobi } from './billing.js';
import { BillingService } from './billing.service.js';
import { RentClaimService } from './claims.service.js';
import { RentStkService } from './rent-stk.service.js';
import { LeaseService } from './lease.service.js';
import { LedgerService } from './ledger.service.js';
import { OrgService } from './org.service.js';
import { ReportService } from './report.service.js';

// ── Shared field schemas ─────────────────────────────────────────────────────
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').transform(parseDay);
const money = z.coerce.number().positive('Amount must be greater than 0').max(100_000_000).transform((n) => Math.round(n * 100) / 100);
const moneyOrZero = z.coerce.number().min(0).max(100_000_000).transform((n) => Math.round(n * 100) / 100);
const phone = z.string().trim().min(9, 'Enter a phone number').max(20);

const moneyIn = z.object({
  amount: money,
  date: day.optional(),
  method: z.enum(PaymentMethod).optional(),
  reference: optionalString,
  description: optionalString,
});

const leaseCreate = z.object({
  unitId: z.string().min(1, 'Choose a unit'),
  tenantId: optionalString,
  tenant: z.object({
    name: z.string().trim().min(2, 'Tenant name is required').max(255),
    phone,
    email: z.union([z.string().trim().email(), z.literal(''), z.null()]).transform((v) => v || null).optional(),
    idNumber: nullableString,
  }).optional(),
  rentAmount: money,
  depositAmount: moneyOrZero.default(0),
  billingFrequency: z.enum(BillingFrequency).default('MONTHLY'),
  dueDay: z.coerce.number().int().min(1).max(28, 'Use a due day between 1 and 28'),
  startDate: day,
  endDate: day.nullable().optional(),
  billFrom: day.optional(),
  notes: optionalString,
  depositReceived: z.object({ amount: money, method: z.enum(PaymentMethod), reference: optionalString, date: day.optional() }).optional(),
});

const leaseUpdate = z.object({
  rentAmount: money.optional(),
  depositAmount: moneyOrZero.optional(),
  billingFrequency: z.enum(BillingFrequency).optional(),
  dueDay: z.coerce.number().int().min(1).max(28).optional(),
  endDate: day.nullable().optional(),
  notes: nullableString,
});

const listLeases = paginationSchema.extend({
  status: z.enum(LeaseStatus).optional(),
  propertyId: optionalString,
  locationId: optionalString,
  search: optionalString,
  arrearsOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const listLedger = paginationSchema.extend({
  type: z.enum(LedgerEntryType).optional(),
  propertyId: optionalString,
  leaseId: optionalString,
  search: optionalString,
  from: day.optional(),
  to: day.optional(),
});

const locationIn = z.object({ name: z.string().trim().min(2, 'Name is required').max(100), county: optionalString, description: optionalString });

const staffIn = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().email('Enter a valid email'),
  username: z.string().trim().min(3, 'At least 3 characters').max(60).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dots, dashes and underscores only'),
  phone: optionalString,
  password: z.string().min(8, 'At least 8 characters'),
  staffRole: z.enum(LandlordStaffRole),
  allProperties: z.boolean().default(true),
  propertyIds: z.array(z.string()).default([]),
});

const staffUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: nullableString,
  password: z.string().min(8, 'At least 8 characters').optional(),
  staffRole: z.enum(LandlordStaffRole).optional(),
  allProperties: z.boolean().optional(),
  propertyIds: z.array(z.string()).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

type Id = { Params: { id: string } };

/** /landlord - rent management: locations, leases, ledger, reports and staff. */
export async function rentalsRoutes(app: FastifyInstance, ctx: AppContext) {
  const leases = new LeaseService(ctx);
  const ledger = new LedgerService(ctx);
  const org = new OrgService(ctx);
  const reports = new ReportService(ctx);
  const billing = new BillingService(ctx);
  const claims = new RentClaimService(ctx);
  const stk = new RentStkService(ctx);

  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(LANDLORD_ORG_ROLES));
  const access = (req: Parameters<typeof landlordAccess>[1]) => landlordAccess(ctx, req);

  /** Who am I in this landlord organization (role, permissions, property scope). */
  app.get('/access', async (req) => ({ ok: true, data: describeAccess(await access(req)) }));

  // ── Locations ──────────────────────────────────────────────────────────────
  app.get('/locations', async (req) => ({ ok: true, data: await org.listLocations(await access(req)) }));
  app.post('/locations', async (req, reply) => reply.status(201).send({ ok: true, data: await org.createLocation(await access(req), parse(locationIn, req.body)) }));
  app.patch<Id>('/locations/:id', async (req) => ({ ok: true, data: await org.updateLocation(await access(req), req.params.id, parse(locationIn.partial(), req.body)) }));
  app.delete<Id>('/locations/:id', async (req) => {
    await org.removeLocation(await access(req), req.params.id);
    return { ok: true, message: 'Location removed' };
  });

  // ── Leases ─────────────────────────────────────────────────────────────────
  app.get('/vacant-units', async (req) => {
    const { propertyId } = parse(z.object({ propertyId: optionalString }), req.query);
    return { ok: true, data: await leases.vacantUnits(await access(req), propertyId) };
  });
  app.get('/leases', async (req) => ({ ok: true, ...(await leases.list(await access(req), parse(listLeases, req.query))) }));
  app.post('/leases', async (req, reply) => reply.status(201).send({ ok: true, data: await leases.create(await access(req), parse(leaseCreate, req.body)) }));
  app.get<Id>('/leases/:id', async (req) => ({ ok: true, data: await leases.get(await access(req), req.params.id) }));
  app.patch<Id>('/leases/:id', async (req) => ({ ok: true, data: await leases.update(await access(req), req.params.id, parse(leaseUpdate, req.body)) }));
  app.post<Id>('/leases/:id/terminate', async (req) => {
    const input = parse(z.object({ endDate: day, reason: z.string().trim().min(3, 'Give a short reason').max(500) }), req.body);
    return { ok: true, data: await leases.terminate(await access(req), req.params.id, input) };
  });
  app.get<Id>('/leases/:id/statement', async (req) => ({ ok: true, data: await ledger.statement(await access(req), req.params.id) }));

  // ── Money against a lease ──────────────────────────────────────────────────
  const withDate = <T extends { date?: Date }>(v: T) => ({ ...v, date: v.date ?? todayNairobi() });

  app.post<Id>('/leases/:id/payments', async (req, reply) =>
    reply.status(201).send({ ok: true, data: await ledger.recordPayment(await access(req), req.params.id, withDate(parse(moneyIn, req.body))) }));
  app.post<Id>('/leases/:id/charges', async (req, reply) => {
    const input = parse(moneyIn.extend({ dueDate: day.optional(), category: optionalString }), req.body);
    return reply.status(201).send({ ok: true, data: await ledger.addCharge(await access(req), req.params.id, withDate(input)) });
  });
  app.post<Id>('/leases/:id/credits', async (req, reply) =>
    reply.status(201).send({ ok: true, data: await ledger.addCredit(await access(req), req.params.id, withDate(parse(moneyIn, req.body))) }));
  app.post<Id>('/leases/:id/deposits', async (req, reply) => {
    const input = parse(moneyIn.extend({ action: z.enum(['RECEIVED', 'REFUND', 'APPLIED']) }), req.body);
    return reply.status(201).send({ ok: true, data: await ledger.deposit(await access(req), req.params.id, input.action, withDate(input)) });
  });

  /** Send the tenant an M-Pesa prompt for rent or deposit; poll GET /mpesa/query/:checkoutRequestId for the outcome. */
  app.post<Id>('/leases/:id/stk-push', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const input = parse(z.object({
      purpose: z.enum(RentClaimPurpose).default('RENT'),
      amount: z.coerce.number().int('M-Pesa takes whole shillings').min(1, 'Minimum is KES 1'),
      phone: optionalString,
    }), req.body);
    return { ok: true, data: await stk.request(await access(req), req.params.id, input) };
  });

  // ── Ledger ─────────────────────────────────────────────────────────────────
  app.get('/ledger', async (req) => ({ ok: true, ...(await ledger.list(await access(req), parse(listLedger, req.query))) }));
  app.post('/ledger/expenses', async (req, reply) => {
    const input = parse(moneyIn.extend({ propertyId: z.string().min(1, 'Choose a property'), unitId: optionalString, category: z.string().trim().min(2, 'Choose a category').max(60) }), req.body);
    return reply.status(201).send({ ok: true, data: await ledger.addExpense(await access(req), withDate(input)) });
  });
  app.post<Id>('/ledger/:id/reverse', async (req, reply) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(300) }), req.body);
    return reply.status(201).send({ ok: true, data: await ledger.reverse(await access(req), req.params.id, reason) });
  });
  app.get('/arrears', async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) }), req.query);
    return { ok: true, data: await ledger.arrearsList(await access(req), limit) };
  });

  // ── Payments reported by tenants ───────────────────────────────────────────
  app.get('/payment-claims', async (req) => {
    const q = parse(paginationSchema.extend({ status: z.enum(RentClaimStatus).optional() }), req.query);
    return { ok: true, ...(await claims.list(await access(req), q)) };
  });
  app.post<Id>('/payment-claims/:id/confirm', async (req) => {
    const input = parse(z.object({ amount: money.optional(), date: day.optional(), note: optionalString }), req.body ?? {});
    return { ok: true, message: 'Payment confirmed and posted', data: await claims.confirm(await access(req), req.params.id, input) };
  });
  app.post<Id>('/payment-claims/:id/reject', async (req) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(3, 'Tell the tenant why').max(300) }), req.body);
    return { ok: true, message: 'Payment rejected', data: await claims.reject(await access(req), req.params.id, reason) };
  });

  // ── Reports ────────────────────────────────────────────────────────────────
  app.get('/reports/summary', async (req) => {
    const today = todayNairobi();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const q = parse(z.object({ from: day.optional(), to: day.optional(), groupBy: z.enum(['property', 'location']).default('property') }), req.query);
    return { ok: true, data: await reports.summary(await access(req), { from: q.from ?? monthStart, to: q.to ?? today, groupBy: q.groupBy }) };
  });

  // ── Staff (owner only) ─────────────────────────────────────────────────────
  app.get('/staff', async (req) => ({ ok: true, data: await org.listStaff(await access(req)) }));
  app.post('/staff', async (req, reply) => reply.status(201).send({ ok: true, data: await org.createStaff(await access(req), parse(staffIn, req.body)) }));
  app.patch<Id>('/staff/:id', async (req) => ({ ok: true, data: await org.updateStaff(await access(req), req.params.id, parse(staffUpdate, req.body)) }));
  app.delete<Id>('/staff/:id', async (req) => {
    await org.removeStaff(await access(req), req.params.id);
    return { ok: true, message: 'Staff access revoked' };
  });

  // ── Billing ────────────────────────────────────────────────────────────────
  /** Bill this landlord's due leases now (the scheduler also runs hourly). */
  app.post('/billing/run', async (req) => {
    const a = await access(req);
    assertCan(a, 'charges.manage');
    return { ok: true, data: await billing.runDue(todayNairobi(), a.landlordId) };
  });
}
