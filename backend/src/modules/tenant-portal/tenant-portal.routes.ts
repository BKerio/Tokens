import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PaymentMethod, RentClaimPurpose } from '../../generated/prisma/index.js';
import { optionalString, parse } from '../../shared/utils/validation.js';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { Role } from '../../shared/types/index.js';
import { ForbiddenError } from '../../shared/errors/AppError.js';
import { ROLE_PERMISSIONS, type LandlordAccess } from '../rentals/access.js';
import { LeaseService } from '../rentals/lease.service.js';
import { LedgerService } from '../rentals/ledger.service.js';
import { paymentSources } from '../properties/payment-sources.js';
import { RentClaimService } from '../rentals/claims.service.js';
import { parseDay } from '../rentals/billing.js';

const claimIn = z.object({
  purpose: z.enum(RentClaimPurpose),
  method: z.enum([PaymentMethod.MPESA, PaymentMethod.CASH]),
  amount: z.coerce.number().positive('Enter the amount you paid').max(100_000_000).transform((n) => Math.round(n * 100) / 100),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date you paid').transform(parseDay),
  reference: optionalString,
  note: z.string().trim().max(300).optional(),
});

/**
 * /tenant - the signed-in tenant's own tenancy: leases, balance, statement and
 * where to pay. Access is re-checked on every request, so a landlord turning
 * portal access off takes effect immediately.
 */
export async function tenantPortalRoutes(app: FastifyInstance, ctx: AppContext) {
  const leases = new LeaseService(ctx);
  const ledger = new LedgerService(ctx);
  const claims = new RentClaimService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole([Role.TENANT]));

  const me = async (req: FastifyRequest) => {
    const tenant = await ctx.prisma.landlordTenant.findUnique({
      where: { id: req.user.userId },
      include: { landlord: { select: { id: true, fullName: true, phone: true } } },
    });
    if (!tenant || !tenant.portalAccess || tenant.status !== 'ACTIVE') throw new ForbiddenError('Your tenant account is not active. Contact your landlord.');
    return tenant;
  };

  /** Read-only view of the landlord's books, limited below to this tenant's own leases. */
  const ownerView = (landlordId: string, landlordName: string, actorId: string): LandlordAccess => ({
    landlordId, landlordName, actorId, role: 'OWNER', permissions: new Set(ROLE_PERMISSIONS.VIEWER), allProperties: true, propertyIds: [],
  });

  app.get('/overview', async (req) => {
    const tenant = await me(req);
    const view = ownerView(tenant.landlordId, tenant.landlord.fullName, tenant.id);
    const rows = await ctx.prisma.lease.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      select: { id: true, status: true, unitId: true },
      take: 10,
    });
    const sources = await paymentSources(ctx, tenant.landlordId);

    const out: unknown[] = [];
    for (const row of rows) {
      const lease = await leases.get(view, row.id);
      const statement = row.status === 'ACTIVE' || out.length === 0 ? await ledger.statement(view, row.id) : null;
      const unit = await ctx.prisma.propertyUnit.findUnique({
        where: { id: row.unitId },
        select: { paymentSource: true, paymentMethod: true, paymentNumber: true, paymentAccount: true, paymentAccountName: true, meter: { select: { meterNumber: true, type: true } } },
      });
      const live = unit?.paymentSource ? sources.find((s) => s.key === unit.paymentSource) : undefined;
      out.push({
        id: lease.id,
        code: lease.code,
        status: lease.status,
        rentAmount: Number(lease.rentAmount),
        depositAmount: Number(lease.depositAmount),
        billingFrequency: lease.billingFrequency,
        dueDay: lease.dueDay,
        startDate: lease.startDate,
        endDate: lease.endDate,
        unit: lease.unit,
        property: lease.property,
        account: lease.account,
        nextCharge: lease.nextCharge,
        meter: unit?.meter ?? null,
        // Where to pay: the unit's configured account; a blank paybill account means "use your lease code".
        payTo: unit?.paymentMethod ? {
          method: live?.method ?? unit.paymentMethod,
          number: live?.number ?? unit.paymentNumber,
          account: unit.paymentMethod === 'MPESA_PAYBILL' ? unit.paymentAccount ?? lease.code : null,
          accountName: unit.paymentAccountName,
        } : null,
        statement: statement?.entries.slice(-40).reverse().map((e) => ({
          id: e.id, type: e.type, amount: Number(e.amount), entryDate: e.entryDate, description: e.description,
          reference: e.reference, method: e.method, balance: e.balance, reversed: e.reversed, isReversal: !!e.reversalOfId,
        })) ?? null,
      });
    }

    return {
      ok: true,
      data: {
        claims: await claims.listForTenant(tenant.id),
        tenant: { id: tenant.id, name: tenant.name, phone: tenant.phone, email: tenant.email },
        landlord: { name: tenant.landlord.fullName, phone: tenant.landlord.phone },
        leases: out,
      },
    };
  });

  /**
   * "I've paid": the tenant reports an M-Pesa (with receipt) or cash payment
   * for rent or deposit. It shows on their statement only after the landlord confirms it.
   */
  app.post<{ Params: { id: string } }>('/leases/:id/payment-claims', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const tenant = await me(req);
    const claim = await claims.submit({ id: tenant.id, name: tenant.name, landlordId: tenant.landlordId }, req.params.id, parse(claimIn, req.body));
    return reply.status(201).send({ ok: true, message: 'Payment sent to your landlord to confirm', data: claim });
  });
}
