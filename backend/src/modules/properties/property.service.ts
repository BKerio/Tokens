import { AppContext } from '../../context.js';
import type { LandlordTenant, Prisma, PropertyUnit } from '../../generated/prisma/index.js';
import { PropertyType, RecordStatus, UnitOccupancy, UnitPaymentMethod } from '../../shared/types/index.js';
import { normalizeMsisdn } from '../../shared/utils/phone.js';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';

export interface PropertyInput {
  name: string;
  propertyType: PropertyType;
  noOfUnits: number;
  location: string;
  status?: RecordStatus;
  locationId?: string | null;
  countyId?: number | null;
  constituencyId?: number | null;
  wardId?: number | null;
}

const REGION_INCLUDE = {
  county: { select: { id: true, name: true } },
  constituency: { select: { id: true, name: true } },
  ward: { select: { id: true, name: true } },
} satisfies Prisma.PropertyInclude;

/** Where a unit's tenant pays rent. `account` blank on a paybill means "use the lease code". */
export interface PaymentAccountInput {
  method: UnitPaymentMethod;
  number: string;
  account?: string | null;
  bank?: string | null;
  accountName?: string | null;
}

export interface UnitInput {
  name?: string;
  unitNumber?: string | null;
  status?: RecordStatus;
  monthlyRent?: number | null;
  depositAmount?: number | null;
  /** null clears the unit's payment account; undefined leaves it alone. */
  payment?: PaymentAccountInput | null;
  occupancy?: UnitOccupancy;
  occupancyNote?: string | null;
  /** The full set of tenants / customers linked to the unit (replaces the current links). */
  tenantIds?: string[];
  customerIds?: string[];
}

export interface LandlordCustomerInput {
  name: string;
  phone: string;
  email?: string | null;
  unitId?: string | null;
  status?: RecordStatus;
}

const UNIT_INCLUDE = {
  meter: { select: { id: true, meterNumber: true } },
  leases: {
    where: { status: 'ACTIVE' },
    take: 1,
    select: { id: true, code: true, tenant: { select: { id: true, name: true, phone: true } } },
  },
  tenants: { select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } },
  customers: { select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } },
} satisfies Prisma.PropertyUnitInclude;

type UnitRow = Prisma.PropertyUnitGetPayload<{ include: typeof UNIT_INCLUDE }>;

/** Payment-account columns for a unit, normalised so only the fields that method uses are kept. */
function paymentColumns(payment: PaymentAccountInput | null) {
  if (!payment) {
    return { paymentMethod: null, paymentNumber: null, paymentAccount: null, paymentBank: null, paymentAccountName: null };
  }
  const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    paymentMethod: payment.method,
    paymentNumber: payment.number.trim(),
    paymentAccount: payment.method === UnitPaymentMethod.MPESA_PAYBILL ? clean(payment.account) : null,
    paymentBank: payment.method === UnitPaymentMethod.BANK ? clean(payment.bank) : null,
    paymentAccountName: clean(payment.accountName),
  };
}

function presentUnit(u: UnitRow) {
  const lease = u.leases[0];
  return {
    id: u.id,
    name: u.name,
    unitNumber: u.unitNumber,
    status: u.status,
    // An active lease always means occupied, whatever was set by hand.
    occupancy: lease ? UnitOccupancy.OCCUPIED : u.occupancy,
    occupancyNote: u.occupancyNote,
    tenants: u.tenants,
    customers: u.customers,
    meterId: u.meterId,
    meterNumber: u.meter?.meterNumber ?? null,
    monthlyRent: u.monthlyRent === null ? null : Number(u.monthlyRent),
    depositAmount: u.depositAmount === null ? null : Number(u.depositAmount),
    payment: u.paymentMethod
      ? {
          method: u.paymentMethod,
          number: u.paymentNumber ?? '',
          account: u.paymentAccount,
          bank: u.paymentBank,
          accountName: u.paymentAccountName,
        }
      : null,
    activeLease: lease ? { id: lease.id, code: lease.code, tenantId: lease.tenant.id, tenantName: lease.tenant.name, tenantPhone: lease.tenant.phone } : null,
  };
}

const CUSTOMER_SELECT = {
  id: true, name: true, phone: true, email: true, status: true, createdAt: true, unitId: true, meterId: true,
  unit: { select: { id: true, name: true, property: { select: { id: true, name: true } } } },
  meter: { select: { meterNumber: true } },
} satisfies Prisma.CustomerSelect;

function presentTenant(t: LandlordTenant) {
  return {
    id: t.id,
    name: t.name,
    phone: t.phone,
    email: t.email,
    idNumber: t.idNumber,
    status: t.status,
    unitId: t.unitId,
    propertyId: t.propertyId,
  };
}

/** Natural sort so "Unit 2" comes before "Unit 10". */
const byUnitName = (a: PropertyUnit, b: PropertyUnit) =>
  (a.unitNumber ?? a.name).localeCompare(b.unitNumber ?? b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * A landlord's properties and their units (each with rent defaults, a meter
 * link and a payment account) plus tenants. Every method is scoped to the
 * calling landlord. A property's `noOfUnits` always equals its unit count.
 */
export class PropertyService {
  constructor(private app: AppContext) {}

  private async audit(actorId: string, action: 'CREATE' | 'UPDATE' | 'DELETE', id: string, summary: string) {
    await this.app.auditLog.record({ actorId, action, subjectType: 'HIERARCHY', subjectId: id, summary });
  }

  // ── Properties ─────────────────────────────────────────────────────────────

  /** `propertyIds` limits the list for staff scoped to some properties. */
  async list(landlordId: string, search?: string, propertyIds?: string[], locationId?: string) {
    const where: Prisma.PropertyWhereInput = { landlordId };
    if (propertyIds) where.id = { in: propertyIds };
    if (locationId) where.locationId = locationId === 'none' ? null : locationId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { locationGroup: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    return this.app.prisma.property.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        locationGroup: { select: { id: true, name: true } },
        ...REGION_INCLUDE,
        _count: { select: { units: true, tenants: true, leases: { where: { status: 'ACTIVE' } } } },
      },
    });
  }

  async get(landlordId: string, id: string) {
    const property = await this.app.prisma.property.findFirst({ where: { id, landlordId } });
    if (!property) throw new NotFoundError('Property');
    return property;
  }

  /** Checks the ward sits in the constituency, and the constituency in the county. */
  private async assertRegion(countyId?: number | null, constituencyId?: number | null, wardId?: number | null) {
    if (countyId && !(await this.app.prisma.county.findUnique({ where: { id: countyId } }))) {
      throw new UnprocessableError('Unknown county.');
    }
    if (constituencyId) {
      const c = await this.app.prisma.constituency.findUnique({ where: { id: constituencyId } });
      if (!c || (countyId && c.countyId !== countyId)) throw new UnprocessableError('That constituency is not in the selected county.');
    }
    if (wardId) {
      const w = await this.app.prisma.ward.findUnique({ where: { id: wardId } });
      if (!w || (constituencyId && w.constituencyId !== constituencyId) || (countyId && w.countyId !== countyId)) {
        throw new UnprocessableError('That ward is not in the selected constituency.');
      }
    }
  }

  /** Creates the property and its `noOfUnits` units (Unit 1 … Unit N). */
  async create(landlordId: string, actorId: string, input: PropertyInput) {
    await this.assertRegion(input.countyId, input.constituencyId, input.wardId);
    const landlord = await this.app.prisma.landlord.findUniqueOrThrow({ where: { id: landlordId } });
    const property = await this.app.prisma.$transaction(async (tx) => {
      const created = await tx.property.create({ data: { ...input, landlordId, ownerName: landlord.fullName } });
      await tx.propertyUnit.createMany({
        data: Array.from({ length: input.noOfUnits }, (_, i) => ({
          landlordId, propertyId: created.id, name: `Unit ${i + 1}`, unitNumber: String(i + 1),
        })),
      });
      return created;
    });
    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'PROPERTY', subjectId: property.id,
      summary: `Added property ${property.name} with ${input.noOfUnits} unit(s)`,
    });
    return property;
  }

  /** A change to `noOfUnits` adds units, or removes the newest units that have never been let. */
  async update(landlordId: string, actorId: string, id: string, input: Partial<PropertyInput>) {
    const before = await this.get(landlordId, id);
    const { noOfUnits, ...rest } = input;
    // A new county clears a constituency / ward that isn't re-sent with it.
    if (rest.countyId !== undefined && rest.countyId !== before.countyId) {
      rest.constituencyId ??= null;
      rest.wardId ??= null;
    }
    if (rest.constituencyId !== undefined && rest.constituencyId !== before.constituencyId) rest.wardId ??= null;
    await this.assertRegion(
      rest.countyId !== undefined ? rest.countyId : before.countyId,
      rest.constituencyId !== undefined ? rest.constituencyId : before.constituencyId,
      rest.wardId !== undefined ? rest.wardId : before.wardId,
    );

    const property = await this.app.prisma.$transaction(async (tx) => {
      if (noOfUnits !== undefined) {
        const units = (await tx.propertyUnit.findMany({ where: { propertyId: id } })).sort(byUnitName);
        if (noOfUnits > units.length) {
          const highest = units.reduce((max, u) => Math.max(max, Number.parseInt(u.unitNumber ?? '', 10) || 0), 0);
          await tx.propertyUnit.createMany({
            data: Array.from({ length: noOfUnits - units.length }, (_, i) => ({
              landlordId, propertyId: id, name: `Unit ${highest + i + 1}`, unitNumber: String(highest + i + 1),
            })),
          });
        } else if (noOfUnits < units.length) {
          const excess = units.length - noOfUnits;
          const letIds = new Set(
            (await tx.lease.findMany({ where: { propertyId: id }, select: { unitId: true }, distinct: ['unitId'] })).map((l) => l.unitId),
          );
          const removable = units.filter((u) => !letIds.has(u.id)).reverse().slice(0, excess);
          if (removable.length < excess) {
            throw new UnprocessableError(
              `Only ${removable.length} unit(s) can be removed - the rest have lease history. Mark units inactive instead.`,
            );
          }
          await tx.propertyUnit.deleteMany({ where: { id: { in: removable.map((u) => u.id) } } });
        }
      }
      return tx.property.update({ where: { id }, data: { ...rest, ...(noOfUnits !== undefined ? { noOfUnits } : {}) } });
    });

    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'PROPERTY', subjectId: id, summary: `Updated property ${property.name}`,
      oldValues: before, newValues: property,
    });
    return property;
  }

  async remove(landlordId: string, actorId: string, id: string) {
    const property = await this.get(landlordId, id);
    if (await this.app.prisma.lease.count({ where: { propertyId: id } })) {
      throw new UnprocessableError(`${property.name} has lease history and can't be deleted. Mark it inactive instead.`);
    }
    await this.app.prisma.property.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'PROPERTY', subjectId: id, summary: `Deleted property ${property.name}`, oldValues: property,
    });
  }

  /** One property with its units, tenants and the landlord's meters (for linking). */
  async detail(landlordId: string, propertyId: string) {
    await this.get(landlordId, propertyId);
    const [property, units, tenants, assignedMeters] = await Promise.all([
      this.app.prisma.property.findUniqueOrThrow({
        where: { id: propertyId },
        include: { locationGroup: { select: { id: true, name: true } }, ...REGION_INCLUDE },
      }),
      this.app.prisma.propertyUnit.findMany({ where: { propertyId }, include: UNIT_INCLUDE }),
      this.app.prisma.landlordTenant.findMany({ where: { propertyId }, orderBy: { name: 'asc' } }),
      this.app.prisma.meter.findMany({
        where: { landlordId },
        orderBy: { meterNumber: 'asc' },
        select: { id: true, meterNumber: true, status: true },
      }),
    ]);
    return {
      property,
      units: units.sort(byUnitName).map(presentUnit),
      tenants: tenants.map(presentTenant),
      assignedMeters,
    };
  }

  /** Recounts a property's units into `noOfUnits`. */
  private async syncUnitCount(tx: Prisma.TransactionClient, propertyId: string) {
    const count = await tx.propertyUnit.count({ where: { propertyId } });
    await tx.property.update({ where: { id: propertyId }, data: { noOfUnits: count } });
  }

  // ── Units, payment accounts & meter links ─────────────────────────────────

  private async assertMetersOwned(landlordId: string, meterIds: string[]) {
    if (meterIds.length === 0) return;
    const owned = await this.app.prisma.meter.count({ where: { id: { in: meterIds }, landlordId } });
    if (owned !== new Set(meterIds).size) {
      throw new ForbiddenError('This meter is not assigned to your landlord account.');
    }
  }

  private async meterNumber(meterId: string | null | undefined) {
    if (!meterId) return null;
    return (await this.app.prisma.meter.findUnique({ where: { id: meterId }, select: { meterNumber: true } }))?.meterNumber ?? null;
  }

  async createUnit(landlordId: string, actorId: string, input: UnitInput & { propertyId: string; name: string; meterId?: string | null }) {
    await this.get(landlordId, input.propertyId);
    if (input.meterId) await this.assertMetersOwned(landlordId, [input.meterId]);
    const { propertyId, meterId, payment, ...fields } = input;

    const unit = await this.app.prisma.$transaction(async (tx) => {
      if (meterId) await tx.propertyUnit.updateMany({ where: { meterId }, data: { meterId: null } });
      const created = await tx.propertyUnit.create({
        data: {
          ...fields,
          landlordId,
          propertyId,
          meterId: meterId ?? null,
          status: fields.status ?? RecordStatus.ACTIVE,
          ...(payment !== undefined ? paymentColumns(payment) : {}),
        },
        include: UNIT_INCLUDE,
      });
      await this.syncUnitCount(tx, propertyId);
      return created;
    });
    await this.audit(actorId, 'CREATE', unit.id, `Added unit ${unit.name}`);
    return presentUnit(unit);
  }

  /** Creates `count` units named "<prefix> <n>", numbered on from the property's highest unit number. */
  async createUnitsBulk(landlordId: string, actorId: string, propertyId: string, input: { count: number; namePrefix: string; startNumber?: number }) {
    await this.get(landlordId, propertyId);
    const prefix = input.namePrefix.trim();

    const created = await this.app.prisma.$transaction(async (tx) => {
      const existing = await tx.propertyUnit.findMany({ where: { propertyId }, select: { unitNumber: true } });
      const highest = existing.reduce((max, u) => Math.max(max, Number.parseInt(u.unitNumber ?? '', 10) || 0), 0);
      const start = input.startNumber ?? highest + 1;
      const units: UnitRow[] = [];
      for (let i = 0; i < input.count; i++) {
        units.push(await tx.propertyUnit.create({
          data: { landlordId, propertyId, name: `${prefix} ${start + i}`, unitNumber: String(start + i) },
          include: UNIT_INCLUDE,
        }));
      }
      await this.syncUnitCount(tx, propertyId);
      return units;
    });
    await this.audit(actorId, 'CREATE', propertyId, `Added ${created.length} units (${prefix} ${created[0]?.unitNumber}…)`);
    return created.map(presentUnit);
  }

  /** Copies one payment account onto every unit of a property (or only those without one). */
  async applyPaymentAccount(landlordId: string, actorId: string, propertyId: string, payment: PaymentAccountInput, onlyMissing: boolean) {
    const property = await this.get(landlordId, propertyId);
    const { count } = await this.app.prisma.propertyUnit.updateMany({
      where: { propertyId, ...(onlyMissing ? { paymentMethod: null } : {}) },
      data: paymentColumns(payment),
    });
    await this.audit(actorId, 'UPDATE', propertyId, `Set the payment account on ${count} unit(s) of ${property.name}`);
    return { updated: count };
  }

  /** Bulk unit ↔ meter assignment for one property (meterId null unlinks). */
  async syncUnitMeters(landlordId: string, actorId: string, propertyId: string, assignments: { unitId: string; meterId?: string | null }[]) {
    await this.get(landlordId, propertyId);
    const unitIds = Array.from(new Set(assignments.map((a) => a.unitId)));
    const units = await this.app.prisma.propertyUnit.count({ where: { id: { in: unitIds }, propertyId, landlordId } });
    if (units !== unitIds.length) throw new UnprocessableError('One or more units do not belong to this property.');

    const meterIds = assignments.map((a) => a.meterId).filter((m): m is string => !!m);
    if (meterIds.length !== new Set(meterIds).size) throw new UnprocessableError('Each meter can only be linked to one unit.');
    await this.assertMetersOwned(landlordId, meterIds);

    await this.app.prisma.$transaction(async (tx) => {
      // Clear first so swapping meters between units never trips the unique constraint.
      await tx.propertyUnit.updateMany({
        where: { OR: [{ id: { in: unitIds } }, ...(meterIds.length ? [{ meterId: { in: meterIds } }] : [])] },
        data: { meterId: null },
      });
      for (const a of assignments) {
        if (a.meterId) await tx.propertyUnit.update({ where: { id: a.unitId }, data: { meterId: a.meterId } });
      }
    });
    await this.audit(actorId, 'UPDATE', propertyId, `Saved meter assignments for ${assignments.length} unit(s)`);

    const updated = await this.app.prisma.propertyUnit.findMany({ where: { id: { in: unitIds } }, include: UNIT_INCLUDE });
    return updated.map(presentUnit);
  }

  private async ownedUnit(landlordId: string, id: string) {
    const unit = await this.app.prisma.propertyUnit.findUnique({ where: { id } });
    if (!unit) throw new NotFoundError('Unit');
    if (unit.landlordId !== landlordId) throw new ForbiddenError('Access denied.');
    return unit;
  }

  async updateUnit(landlordId: string, actorId: string, id: string, input: UnitInput) {
    const current = await this.ownedUnit(landlordId, id);
    const { payment, tenantIds, customerIds, ...fields } = input;

    if (fields.occupancy && fields.occupancy !== UnitOccupancy.OCCUPIED) {
      const lease = await this.app.prisma.lease.findFirst({ where: { unitId: id, status: 'ACTIVE' }, select: { code: true } });
      if (lease) throw new UnprocessableError(`This unit is let on lease ${lease.code}. End the lease before marking it ${fields.occupancy.toLowerCase()}.`);
    }
    if (tenantIds?.length) {
      const owned = await this.app.prisma.landlordTenant.count({ where: { id: { in: tenantIds }, landlordId } });
      if (owned !== new Set(tenantIds).size) throw new ForbiddenError('One or more tenants are not yours.');
    }
    if (customerIds?.length) {
      const owned = await this.app.prisma.customer.count({ where: { id: { in: customerIds }, landlordId } });
      if (owned !== new Set(customerIds).size) throw new ForbiddenError('One or more customers are not yours.');
    }

    const unit = await this.app.prisma.$transaction(async (tx) => {
      if (tenantIds) {
        await tx.landlordTenant.updateMany({ where: { unitId: id, id: { notIn: tenantIds } }, data: { unitId: null } });
        if (tenantIds.length) await tx.landlordTenant.updateMany({ where: { id: { in: tenantIds } }, data: { unitId: id, propertyId: current.propertyId } });
      }
      if (customerIds) {
        // Unlinked customers lose this unit's meter; linked ones buy tokens for it.
        await tx.customer.updateMany({ where: { unitId: id, id: { notIn: customerIds }, meterId: current.meterId ?? undefined }, data: { unitId: null, meterId: null } });
        await tx.customer.updateMany({ where: { unitId: id, id: { notIn: customerIds } }, data: { unitId: null } });
        if (customerIds.length) await tx.customer.updateMany({ where: { id: { in: customerIds } }, data: { unitId: id, meterId: current.meterId } });
      }
      const linksSomeone = (tenantIds?.length ?? 0) + (customerIds?.length ?? 0) > 0;
      const occupancy = fields.occupancy ?? (linksSomeone && current.occupancy === UnitOccupancy.VACANT ? UnitOccupancy.OCCUPIED : undefined);
      return tx.propertyUnit.update({
        where: { id },
        data: { ...fields, ...(occupancy ? { occupancy } : {}), ...(payment !== undefined ? paymentColumns(payment) : {}) },
        include: UNIT_INCLUDE,
      });
    });
    await this.audit(actorId, 'UPDATE', id, `Updated unit ${unit.name}`);
    return presentUnit(unit);
  }

  async assignUnitMeter(landlordId: string, actorId: string, id: string, meterId: string | null) {
    await this.ownedUnit(landlordId, id);
    if (meterId) await this.assertMetersOwned(landlordId, [meterId]);
    const unit = await this.app.prisma.$transaction(async (tx) => {
      if (meterId) await tx.propertyUnit.updateMany({ where: { meterId, id: { not: id } }, data: { meterId: null } });
      // Customers linked to the unit buy tokens for whichever meter it has.
      await tx.customer.updateMany({ where: { unitId: id }, data: { meterId } });
      return tx.propertyUnit.update({ where: { id }, data: { meterId }, include: UNIT_INCLUDE });
    });
    await this.audit(actorId, 'UPDATE', id, meterId ? `Linked meter ${await this.meterNumber(meterId)} to unit ${unit.name}` : `Unlinked meter from unit ${unit.name}`);
    return presentUnit(unit);
  }

  async removeUnit(landlordId: string, actorId: string, id: string) {
    const unit = await this.ownedUnit(landlordId, id);
    if (await this.app.prisma.lease.count({ where: { unitId: id } })) {
      throw new UnprocessableError(`${unit.name} has lease history and can't be deleted. Mark it inactive instead.`);
    }
    await this.app.prisma.$transaction(async (tx) => {
      await tx.propertyUnit.delete({ where: { id } });
      await this.syncUnitCount(tx, unit.propertyId);
    });
    await this.audit(actorId, 'DELETE', id, `Deleted unit ${unit.name}`);
  }

  // ── Customers (token buyers in a landlord's units) ─────────────────────────

  /** Linking someone to an empty unit means it is now occupied. */
  private async occupy(unitId: string | null | undefined) {
    if (unitId) await this.app.prisma.propertyUnit.updateMany({ where: { id: unitId, occupancy: UnitOccupancy.VACANT }, data: { occupancy: UnitOccupancy.OCCUPIED } });
  }

  /** Staff scoped to some properties only see customers linked to units in them. */
  async listCustomers(landlordId: string, scopeIds?: string[]) {
    return this.app.prisma.customer.findMany({
      where: { landlordId, ...(scopeIds ? { unit: { propertyId: { in: scopeIds } } } : {}) },
      orderBy: { name: 'asc' },
      select: CUSTOMER_SELECT,
    });
  }

  private async ownedCustomer(landlordId: string, id: string) {
    const customer = await this.app.prisma.customer.findUnique({ where: { id }, include: { unit: { select: { propertyId: true } } } });
    if (!customer) throw new NotFoundError('Customer');
    if (customer.landlordId !== landlordId) throw new ForbiddenError('Access denied.');
    return customer;
  }

  /** propertyId of a unit the landlord owns (for staff scope checks), or null. */
  async unitProperty(landlordId: string, unitId?: string | null) {
    if (!unitId) return null;
    const unit = await this.ownedUnit(landlordId, unitId);
    return unit.propertyId;
  }

  async customerProperty(landlordId: string, id: string) {
    return (await this.ownedCustomer(landlordId, id)).unit?.propertyId ?? null;
  }

  async createCustomer(landlordId: string, actorId: string, input: LandlordCustomerInput) {
    const unit = input.unitId ? await this.ownedUnit(landlordId, input.unitId) : null;
    const customer = await this.app.prisma.customer.create({
      data: {
        landlordId,
        name: input.name,
        phone: normalizeMsisdn(input.phone) ?? input.phone,
        email: input.email ?? null,
        status: input.status ?? RecordStatus.ACTIVE,
        unitId: unit?.id ?? null,
        meterId: unit?.meterId ?? null,
      },
      select: CUSTOMER_SELECT,
    });
    await this.occupy(customer.unitId);
    await this.app.auditLog.record({ actorId, action: 'CREATE', subjectType: 'CUSTOMER', subjectId: customer.id, summary: `Added customer ${customer.name}` });
    return customer;
  }

  async updateCustomer(landlordId: string, actorId: string, id: string, input: Partial<LandlordCustomerInput>) {
    const before = await this.ownedCustomer(landlordId, id);
    const { unitId, phone, ...rest } = input;
    let link = {};
    if (unitId !== undefined) {
      const unit = unitId ? await this.ownedUnit(landlordId, unitId) : null;
      link = { unitId: unit?.id ?? null, meterId: unit?.meterId ?? null };
    }
    const customer = await this.app.prisma.customer.update({
      where: { id },
      data: { ...rest, ...(phone ? { phone: normalizeMsisdn(phone) ?? phone } : {}), ...link },
      select: CUSTOMER_SELECT,
    });
    if (unitId) await this.occupy(customer.unitId);
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'CUSTOMER', subjectId: id, summary: `Updated customer ${customer.name}`, oldValues: before, newValues: customer,
    });
    return customer;
  }

  async removeCustomer(landlordId: string, actorId: string, id: string) {
    const customer = await this.ownedCustomer(landlordId, id);
    await this.app.prisma.customer.delete({ where: { id } });
    await this.app.auditLog.record({ actorId, action: 'DELETE', subjectType: 'CUSTOMER', subjectId: id, summary: `Removed customer ${customer.name}` });
  }

  // ── Tenants ────────────────────────────────────────────────────────────────

  private async assertUnit(unitId: string | null | undefined, propertyId: string, landlordId: string) {
    if (!unitId) return;
    const unit = await this.app.prisma.propertyUnit.findUnique({ where: { id: unitId }, select: { propertyId: true, landlordId: true } });
    if (!unit || unit.propertyId !== propertyId || unit.landlordId !== landlordId) {
      throw new UnprocessableError('That unit is not part of this property.');
    }
  }

  async listTenants(landlordId: string, propertyId?: string, scopeIds?: string[]) {
    const tenants = await this.app.prisma.landlordTenant.findMany({
      where: { landlordId, ...(propertyId ? { propertyId } : scopeIds ? { propertyId: { in: scopeIds } } : {}) },
      orderBy: { name: 'asc' },
      include: {
        property: { select: { name: true } },
        unit: { select: { name: true } },
        leases: { where: { status: 'ACTIVE' }, select: { id: true, code: true }, take: 1 },
      },
    });
    return tenants.map((t) => ({
      ...presentTenant(t),
      propertyName: t.property.name,
      unitName: t.unit?.name ?? null,
      activeLease: t.leases[0] ?? null,
    }));
  }

  async createTenant(
    landlordId: string,
    actorId: string,
    input: { propertyId: string; name: string; phone: string; email?: string | null; idNumber?: string | null; unitId?: string | null; status?: RecordStatus },
  ) {
    await this.get(landlordId, input.propertyId);
    await this.assertUnit(input.unitId, input.propertyId, landlordId);
    const tenant = await this.app.prisma.landlordTenant.create({
      data: {
        landlordId,
        propertyId: input.propertyId,
        unitId: input.unitId ?? null,
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        idNumber: input.idNumber ?? null,
        status: input.status ?? RecordStatus.ACTIVE,
      },
    });
    await this.occupy(tenant.unitId);
    await this.app.auditLog.record({ actorId, action: 'CREATE', subjectType: 'TENANT', subjectId: tenant.id, summary: `Added tenant ${tenant.name}` });
    return presentTenant(tenant);
  }

  async updateTenant(
    landlordId: string,
    actorId: string,
    id: string,
    input: { name?: string; phone?: string; email?: string | null; idNumber?: string | null; unitId?: string | null; propertyId?: string; status?: RecordStatus },
  ) {
    const tenant = await this.app.prisma.landlordTenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundError('Tenant');
    if (tenant.landlordId !== landlordId) throw new ForbiddenError('Access denied.');
    // Moving to another property is allowed; the unit must then be in that property.
    const propertyId = input.propertyId ?? tenant.propertyId;
    if (input.propertyId) await this.get(landlordId, input.propertyId);
    await this.assertUnit(input.unitId, propertyId, landlordId);
    const data = { ...input, ...(input.propertyId && input.propertyId !== tenant.propertyId && input.unitId === undefined ? { unitId: null } : {}) };

    const updated = await this.app.prisma.landlordTenant.update({ where: { id }, data });
    if (input.unitId) await this.occupy(updated.unitId);
    await this.app.auditLog.record({ actorId, action: 'UPDATE', subjectType: 'TENANT', subjectId: id, summary: `Updated tenant ${updated.name}` });
    return presentTenant(updated);
  }

  async removeTenant(landlordId: string, actorId: string, id: string) {
    const tenant = await this.app.prisma.landlordTenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundError('Tenant');
    if (tenant.landlordId !== landlordId) throw new ForbiddenError('Access denied.');
    if (await this.app.prisma.lease.count({ where: { tenantId: id } })) {
      throw new UnprocessableError(`${tenant.name} has lease history and can't be removed. Mark them inactive instead.`);
    }
    await this.app.prisma.landlordTenant.delete({ where: { id } });
    await this.app.auditLog.record({ actorId, action: 'DELETE', subjectType: 'TENANT', subjectId: id, summary: `Removed tenant ${tenant.name}` });
  }
}
