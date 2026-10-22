import { AppContext } from '../../context.js';
import type { Prisma } from '../../generated/prisma/index.js';
import { Role, TokenType, TransactionStatus } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { Actor, canAccessMeter, meterScope } from '../../shared/utils/actor.js';
import { phoneVariants } from '../../shared/utils/phone.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';
import { ManualVendInput, VEND_METER_INCLUDE, VendingService } from './vending.service.js';

const LOOKUP_INCLUDE = {
  vendor: { select: { id: true, businessName: true } },
  landlord: { select: { id: true, fullName: true } },
  customers: { select: { id: true, name: true, phone: true, address: true }, orderBy: { createdAt: 'asc' }, take: 1 },
  unit: {
    include: {
      property: { select: { name: true, location: true } },
    },
  },
} satisfies Prisma.MeterInclude;

type LookupMeter = Prisma.MeterGetPayload<{ include: typeof LOOKUP_INCLUDE }>;

const TRANSACTION_INCLUDE = {
  meter: { select: { id: true, meterNumber: true } },
  vendor: { select: { id: true, businessName: true } },
  landlord: { select: { id: true, fullName: true } },
  customer: { select: { id: true, name: true, phone: true } },
  actorUser: { select: { id: true, name: true } },
  payment: { select: { id: true, channel: true, mpesaReceiptNumber: true } },
} satisfies Prisma.TokenTransactionInclude;

/** A meter plus who owns it, who uses it and which property unit it serves. */
function presentLookup(meter: LookupMeter) {
  const customer = meter.customers[0];
  const unit = meter.unit;
  return {
    id: meter.id,
    meterNumber: meter.meterNumber,
    type: meter.type,
    pricePerUnit: meter.pricePerUnit,
    status: meter.status,
    vendor: meter.vendor ? { id: meter.vendor.id, name: meter.vendor.businessName } : null,
    landlord: meter.landlord ? { id: meter.landlord.id, name: meter.landlord.fullName } : null,
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, address: customer.address } : null,
    location: {
      property: unit?.property.name ?? null,
      unit: unit ? unit.name || unit.unitNumber : null,
      address: unit?.property.location ?? customer?.address ?? null,
    },
  };
}

export class TokenService {
  private vending: VendingService;

  constructor(private app: AppContext) {
    this.vending = new VendingService(app);
  }

  /** Finds meters by (partial) meter number, falling back to customer phone/name - scoped to the actor. */
  async meterLookup(actor: Actor, q: string) {
    const scope = meterScope(actor);
    let meters = await this.app.prisma.meter.findMany({
      where: { AND: [scope, { meterNumber: { contains: q, mode: 'insensitive' } }] },
      include: LOOKUP_INCLUDE,
      take: 10,
    });

    if (meters.length === 0) {
      meters = await this.app.prisma.meter.findMany({
        where: {
          AND: [
            scope,
            {
              customers: {
                some: {
                  OR: [
                    { phone: { in: phoneVariants(q) } },
                    { phone: { contains: q } },
                    { name: { contains: q, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ],
        },
        include: LOOKUP_INCLUDE,
        take: 10,
      });
    }

    if (meters.length === 0) throw new NotFoundError('Matching meter');
    return meters.map(presentLookup);
  }

  async generate(actor: Actor, meterId: string, input: ManualVendInput) {
    const meter = await this.app.prisma.meter.findUnique({ where: { id: meterId }, include: VEND_METER_INCLUDE });
    if (!meter) throw new NotFoundError('Meter');
    if (!canAccessMeter(actor, meter)) throw new ForbiddenError('Unauthorized to manage tokens for this meter.');

    const result = await this.vending.manualVend(meter, actor.userId, input);
    await this.app.auditLog.record({
      actorId: actor.userId,
      action: 'VEND',
      subjectType: 'TOKEN',
      subjectId: result.transaction.id,
      summary: `${input.tokenType === TokenType.CREDIT ? 'Credit' : input.tokenType.replace(/_/g, ' ').toLowerCase()} token for meter ${meter.meterNumber}`,
    });
    return result;
  }

  /** Token transaction history, scoped: admins all, vendors/landlords own meters, customers their meter. */
  async listTransactions(
    actor: Actor,
    filters: {
      meterId?: string; status?: TransactionStatus; tokenType?: TokenType; search?: string;
      from?: Date; to?: Date; page: number; limit: number;
    },
  ) {
    const where: Prisma.TokenTransactionWhereInput = {};

    if (actor.role === Role.CUSTOMER) {
      const customer = await this.app.prisma.customer.findUnique({ where: { id: actor.customerId! }, select: { meterId: true } });
      where.meterId = customer?.meterId ?? '__none__';
    } else if (actor.role === Role.VENDOR) {
      where.vendorId = actor.vendorId ?? '__none__';
    } else if (actor.role === Role.LANDLORD) {
      where.landlordId = actor.landlordId ?? '__none__';
    }

    if (filters.meterId && actor.role !== Role.CUSTOMER) where.meterId = filters.meterId;
    if (filters.status) where.status = filters.status;
    if (filters.tokenType) where.tokenType = filters.tokenType;
    if (filters.from || filters.to) {
      where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
    }
    if (filters.search) {
      where.OR = [
        { meterNumberSnapshot: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search } },
        { externalTransactionId: { contains: filters.search, mode: 'insensitive' } },
        { payment: { mpesaReceiptNumber: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const [data, total, revenue] = await Promise.all([
      this.app.prisma.tokenTransaction.findMany({
        where,
        include: TRANSACTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...paginate(filters.page, filters.limit),
      }),
      this.app.prisma.tokenTransaction.count({ where }),
      this.app.prisma.tokenTransaction.aggregate({
        where: { ...where, status: TransactionStatus.SUCCESS, tokenType: TokenType.CREDIT },
        _sum: { amount: true },
      }),
    ]);

    return { data, meta: { ...pageMeta(total, filters.page, filters.limit), totalAmount: revenue._sum.amount ?? 0 } };
  }

  /**
   * Public "track my token": latest 5 transactions for a meter number or the
   * phone number of the customer on it. Exact matches only, so the public
   * endpoint can't be used to enumerate other people's meters.
   */
  async publicSearch(q: string) {
    const query = q.trim();
    const meters = await this.app.prisma.meter.findMany({
      where: {
        OR: [
          { meterNumber: query },
          { customers: { some: { phone: { in: phoneVariants(query) } } } },
        ],
      },
      select: { id: true, meterNumber: true, type: true },
      take: 10,
    });
    if (meters.length === 0) throw new NotFoundError('Matching meter or customer');

    const byId = new Map(meters.map((m) => [m.id, m]));
    const transactions = await this.app.prisma.tokenTransaction.findMany({
      where: { meterId: { in: meters.map((m) => m.id) } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true, status: true, tokenType: true, amount: true, units: true, tokens: true,
        description: true, createdAt: true, meterId: true,
      },
    });

    return transactions.map((t) => ({ ...t, meter: t.meterId ? byId.get(t.meterId) ?? null : null }));
  }
}
