import { AppContext } from '../../context.js';
import type { Prisma } from '../../generated/prisma/index.js';
import { RecordStatus, Role } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { Actor, customerScope } from '../../shared/utils/actor.js';
import { normalizeMsisdn } from '../../shared/utils/phone.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';

const CUSTOMER_INCLUDE = {
  vendor: { select: { id: true, businessName: true } },
  meter: { select: { id: true, meterNumber: true, type: true, status: true } },
  county: { select: { id: true, name: true } },
  constituency: { select: { id: true, name: true } },
  ward: { select: { id: true, name: true } },
} satisfies Prisma.CustomerInclude;

export interface CustomerInput {
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  meterId: string;
  vendorId?: string;
  countyId?: number | null;
  constituencyId?: number | null;
  wardId?: number | null;
  status?: RecordStatus;
}

export class CustomerService {
  constructor(private app: AppContext) {}

  private async assertVisible(actor: Actor, id: string) {
    const customer = await this.app.prisma.customer.findFirst({ where: { AND: [{ id }, customerScope(actor)] } });
    if (!customer) {
      const exists = await this.app.prisma.customer.count({ where: { id } });
      if (exists) throw new ForbiddenError('Unauthorized');
      throw new NotFoundError('Customer');
    }
    return customer;
  }

  /** Vendors may only attach customers to their own meters; the meter must exist. */
  private async assertMeterUsable(actor: Actor, meterId: string, vendorId: string) {
    const meter = await this.app.prisma.meter.findUnique({ where: { id: meterId }, select: { vendorId: true } });
    if (!meter) throw new UnprocessableError('Selected meter does not exist.');
    if (actor.role === Role.VENDOR && meter.vendorId !== vendorId) {
      throw new ForbiddenError('You can only attach customers to meters assigned to you.');
    }
  }

  /** Checks the ward sits in the constituency, and the constituency in the county. */
  private async assertLocation(countyId?: number | null, constituencyId?: number | null, wardId?: number | null) {
    if (constituencyId) {
      const c = await this.app.prisma.constituency.findUnique({ where: { id: constituencyId } });
      if (!c || (countyId && c.countyId !== countyId)) throw new UnprocessableError('Constituency does not belong to the selected county.');
    }
    if (wardId) {
      const w = await this.app.prisma.ward.findUnique({ where: { id: wardId } });
      if (!w || (constituencyId && w.constituencyId !== constituencyId)) throw new UnprocessableError('Ward does not belong to the selected constituency.');
    }
  }

  async list(actor: Actor, filters: { search?: string; vendorId?: string; page: number; limit: number }) {
    const and: Prisma.CustomerWhereInput[] = [customerScope(actor)];
    if (actor.isAdmin && filters.vendorId) and.push({ vendorId: filters.vendorId });
    if (filters.search) {
      and.push({
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { phone: { contains: filters.search } },
          { email: { contains: filters.search, mode: 'insensitive' } },
          { meter: { meterNumber: { contains: filters.search, mode: 'insensitive' } } },
        ],
      });
    }
    const where = { AND: and };
    const [data, total] = await Promise.all([
      this.app.prisma.customer.findMany({ where, include: CUSTOMER_INCLUDE, orderBy: { createdAt: 'desc' }, ...paginate(filters.page, filters.limit) }),
      this.app.prisma.customer.count({ where }),
    ]);
    return { data, meta: pageMeta(total, filters.page, filters.limit) };
  }

  async get(actor: Actor, id: string) {
    await this.assertVisible(actor, id);
    return this.app.prisma.customer.findUniqueOrThrow({ where: { id }, include: CUSTOMER_INCLUDE });
  }

  async create(actor: Actor, input: CustomerInput) {
    const vendorId = actor.role === Role.VENDOR ? actor.vendorId : input.vendorId;
    if (!vendorId) {
      throw actor.role === Role.VENDOR ? new NotFoundError('Vendor profile') : new UnprocessableError('Select the vendor this customer belongs to.');
    }
    if (actor.isAdmin && !(await this.app.prisma.vendor.count({ where: { id: vendorId } }))) {
      throw new UnprocessableError('Selected vendor does not exist.');
    }
    await this.assertMeterUsable(actor, input.meterId, vendorId);
    await this.assertLocation(input.countyId, input.constituencyId, input.wardId);

    const customer = await this.app.prisma.customer.create({
      data: { ...input, vendorId, phone: normalizeMsisdn(input.phone) ?? input.phone },
      include: CUSTOMER_INCLUDE,
    });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'CREATE', subjectType: 'CUSTOMER', subjectId: customer.id, summary: `Created customer ${customer.name}`,
    });
    return customer;
  }

  async update(actor: Actor, id: string, input: Partial<CustomerInput>) {
    const existing = await this.assertVisible(actor, id);
    const { vendorId: requestedVendor, ...rest } = input;
    const vendorId = actor.isAdmin && requestedVendor ? requestedVendor : existing.vendorId;

    if (rest.meterId) await this.assertMeterUsable(actor, rest.meterId, vendorId ?? '');
    await this.assertLocation(rest.countyId ?? existing.countyId, rest.constituencyId ?? existing.constituencyId, rest.wardId ?? existing.wardId);

    const customer = await this.app.prisma.customer.update({
      where: { id },
      data: {
        ...rest,
        ...(rest.phone ? { phone: normalizeMsisdn(rest.phone) ?? rest.phone } : {}),
        ...(actor.isAdmin && requestedVendor ? { vendorId: requestedVendor } : {}),
      },
      include: CUSTOMER_INCLUDE,
    });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'UPDATE', subjectType: 'CUSTOMER', subjectId: id,
      summary: `Updated customer ${customer.name}`, oldValues: existing, newValues: customer,
    });
    return customer;
  }

  async remove(actor: Actor, id: string) {
    const customer = await this.assertVisible(actor, id);
    await this.app.prisma.customer.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'DELETE', subjectType: 'CUSTOMER', subjectId: id, summary: `Deleted customer ${customer.name}`, oldValues: customer,
    });
  }
}
