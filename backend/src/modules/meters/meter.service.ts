import { AppContext } from '../../context.js';
import type { Prisma } from '../../generated/prisma/index.js';
import { MeterStatus, Role } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { Actor, canAccessMeter, meterScope } from '../../shared/utils/actor.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';

const METER_INCLUDE = {
  vendor: { select: { id: true, businessName: true } },
  landlord: { select: { id: true, fullName: true } },
  _count: { select: { customers: true } },
} satisfies Prisma.MeterInclude;

export interface MeterAdminInput {
  meterNumber: string;
  type: string;
  initialReading?: number;
  status?: MeterStatus;
  vendorId?: string | null;
  landlordId?: string | null;
  sgc?: number | null;
  krn?: number | null;
  ti?: number | null;
  ea?: number | null;
  ken?: number | null;
}

export class MeterService {
  constructor(private app: AppContext) {}

  async list(
    actor: Actor,
    filters: { search?: string; status?: MeterStatus; vendorId?: string; landlordId?: string; unassigned?: boolean; page: number; limit: number },
  ) {
    const where: Prisma.MeterWhereInput = { AND: [meterScope(actor)] };
    const and = where.AND as Prisma.MeterWhereInput[];
    if (filters.search) and.push({ meterNumber: { contains: filters.search, mode: 'insensitive' } });
    if (filters.status) and.push({ status: filters.status });
    if (actor.isAdmin) {
      if (filters.vendorId) and.push({ vendorId: filters.vendorId });
      if (filters.landlordId) and.push({ landlordId: filters.landlordId });
      if (filters.unassigned) and.push({ vendorId: null, landlordId: null });
    }

    const [data, total] = await Promise.all([
      this.app.prisma.meter.findMany({ where, include: METER_INCLUDE, orderBy: { createdAt: 'desc' }, ...paginate(filters.page, filters.limit) }),
      this.app.prisma.meter.count({ where }),
    ]);
    return { data, meta: pageMeta(total, filters.page, filters.limit) };
  }

  async get(actor: Actor, id: string) {
    const meter = await this.app.prisma.meter.findUnique({
      where: { id },
      include: {
        ...METER_INCLUDE,
        customers: { select: { id: true, name: true, phone: true, email: true, status: true } },
        unit: { select: { id: true, name: true, property: { select: { id: true, name: true } } } },
      },
    });
    if (!meter) throw new NotFoundError('Meter');
    if (!canAccessMeter(actor, meter)) throw new ForbiddenError('Unauthorized');
    return meter;
  }

  private async assertOwnersExist(vendorId?: string | null, landlordId?: string | null) {
    if (vendorId && !(await this.app.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }))) {
      throw new UnprocessableError('Selected vendor does not exist.');
    }
    if (landlordId && !(await this.app.prisma.landlord.findUnique({ where: { id: landlordId }, select: { id: true } }))) {
      throw new UnprocessableError('Selected landlord does not exist.');
    }
  }

  /** Admin-only. Price starts at 0 - the assigned vendor sets it. */
  async create(input: MeterAdminInput, actorId: string) {
    await this.assertOwnersExist(input.vendorId, input.landlordId);
    const meter = await this.app.prisma.meter.create({
      data: { ...input, initialReading: input.initialReading ?? 0, pricePerUnit: 0 },
      include: METER_INCLUDE,
    });
    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'METER', subjectId: meter.id, summary: `Created meter ${meter.meterNumber}`,
    });
    return meter;
  }

  /**
   * Admins edit everything except price; vendors may only set the price of
   * their own meters (the vendor dictates pricing). Landlords are read-only.
   */
  async update(actor: Actor, id: string, input: Partial<MeterAdminInput> & { pricePerUnit?: number }) {
    const meter = await this.app.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundError('Meter');

    let data: Prisma.MeterUncheckedUpdateInput;
    if (actor.isAdmin) {
      const { pricePerUnit: _ignored, ...rest } = input;
      await this.assertOwnersExist(rest.vendorId, rest.landlordId);
      data = rest;
    } else if (actor.role === Role.VENDOR && canAccessMeter(actor, meter)) {
      if (input.pricePerUnit === undefined) throw new UnprocessableError('Vendors can only update the price per unit.');
      data = { pricePerUnit: input.pricePerUnit };
    } else {
      throw new ForbiddenError('Unauthorized');
    }

    const updated = await this.app.prisma.meter.update({ where: { id }, data, include: METER_INCLUDE });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'UPDATE', subjectType: 'METER', subjectId: id,
      summary: actor.isAdmin ? `Updated meter ${updated.meterNumber}` : `Set price for meter ${updated.meterNumber} to KES ${input.pricePerUnit}`,
      oldValues: meter, newValues: updated,
    });
    return updated;
  }

  async remove(id: string, actorId: string) {
    const meter = await this.app.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundError('Meter');
    await this.app.prisma.meter.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'METER', subjectId: id, summary: `Deleted meter ${meter.meterNumber}`, oldValues: meter,
    });
  }
}
