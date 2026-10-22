import { randomInt } from 'node:crypto';
import { AppContext } from '../../context.js';
import { Prisma, type BillingFrequency } from '../../generated/prisma/index.js';
import { LeaseStatus, LedgerEntryType, PaymentMethod, RecordStatus } from '../../generated/prisma/index.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { pageMeta } from '../../shared/utils/validation.js';
import { assertCan, assertProperty, scopeWhere, type LandlordAccess } from './access.js';
import { addDays, daysBetween, isoDate, monthlyEquivalent, periodFor, todayNairobi } from './billing.js';
import { BillingService } from './billing.service.js';
import { LedgerService, round2 } from './ledger.service.js';

export interface LeaseCreateInput {
  unitId: string;
  tenantId?: string;
  tenant?: { name: string; phone: string; email?: string | null; idNumber?: string | null };
  rentAmount: number;
  depositAmount: number;
  billingFrequency: BillingFrequency;
  dueDay: number;
  startDate: Date;
  endDate?: Date | null;
  /** First period to bill (defaults to startDate) - use for tenancies that predate the system. */
  billFrom?: Date;
  notes?: string;
  depositReceived?: { amount: number; method: PaymentMethod; reference?: string; date?: Date };
}

export interface LeaseUpdateInput {
  rentAmount?: number;
  depositAmount?: number;
  billingFrequency?: BillingFrequency;
  dueDay?: number;
  endDate?: Date | null;
  notes?: string | null;
}

// Unambiguous characters (no 0/O, 1/I) - codes are read aloud and typed on phones.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 7 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

const LEASE_INCLUDE = {
  tenant: { select: { id: true, name: true, phone: true, email: true, idNumber: true } },
  unit: { select: { id: true, name: true, unitNumber: true } },
  property: { select: { id: true, name: true, locationGroup: { select: { id: true, name: true } } } },
} satisfies Prisma.LeaseInclude;

function isUnique(err: unknown, target?: string) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  return !target || JSON.stringify(err.meta ?? {}).includes(target);
}

export class LeaseService {
  private ledger: LedgerService;
  private billing: BillingService;

  constructor(private app: AppContext) {
    this.ledger = new LedgerService(app);
    this.billing = new BillingService(app);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async list(access: LandlordAccess, f: {
    status?: LeaseStatus; propertyId?: string; locationId?: string; search?: string; arrearsOnly?: boolean; page: number; limit: number;
  }) {
    assertCan(access, 'leases.view');
    if (f.propertyId) assertProperty(access, f.propertyId);
    const where: Prisma.LeaseWhereInput = { ...scopeWhere(access) };
    // "ENDED" means any finished lease - reached its end date or terminated early.
    if (f.status) where.status = f.status === LeaseStatus.ENDED ? { in: [LeaseStatus.ENDED, LeaseStatus.TERMINATED] } : f.status;
    if (f.propertyId) where.propertyId = f.propertyId;
    if (f.locationId) where.property = { locationId: f.locationId };
    if (f.search) {
      where.OR = [
        { code: { contains: f.search, mode: 'insensitive' } },
        { tenant: { name: { contains: f.search, mode: 'insensitive' } } },
        { tenant: { phone: { contains: f.search } } },
        { unit: { name: { contains: f.search, mode: 'insensitive' } } },
      ];
    }

    // Balances drive the "in arrears" filter and sort, so they're computed for the whole match.
    const leases = await this.app.prisma.lease.findMany({ where, include: LEASE_INCLUDE, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 2000 });
    const balances = await this.ledger.balances(leases.map((l) => l.id));
    let rows = leases.map((l) => ({ ...l, monthlyRent: monthlyEquivalent(Number(l.rentAmount), l.billingFrequency), account: balances.get(l.id)! }));
    if (f.arrearsOnly) rows = rows.filter((r) => r.account.arrears > 0).sort((a, b) => b.account.arrears - a.account.arrears);

    const total = rows.length;
    const start = (f.page - 1) * f.limit;
    return { data: rows.slice(start, start + f.limit), meta: pageMeta(total, f.page, f.limit) };
  }

  async get(access: LandlordAccess, id: string) {
    assertCan(access, 'leases.view');
    const lease = await this.app.prisma.lease.findUnique({ where: { id }, include: LEASE_INCLUDE });
    if (!lease || lease.landlordId !== access.landlordId) throw new NotFoundError('Lease');
    assertProperty(access, lease.propertyId);
    const account = await this.ledger.leaseBalance(id);
    const nextCharge = lease.status === LeaseStatus.ACTIVE && lease.nextBillingDate
      ? periodFor({ rentAmount: Number(lease.rentAmount), billingFrequency: lease.billingFrequency, dueDay: lease.dueDay, endDate: lease.endDate }, lease.nextBillingDate)
      : null;
    return { ...lease, account, nextCharge: nextCharge && { periodStart: isoDate(nextCharge.periodStart), periodEnd: isoDate(nextCharge.periodEnd), dueDate: isoDate(nextCharge.dueDate), amount: nextCharge.amount } };
  }

  /** Units with no active lease (optionally in one property), with their default rent. */
  async vacantUnits(access: LandlordAccess, propertyId?: string) {
    assertCan(access, 'leases.view');
    if (propertyId) assertProperty(access, propertyId);
    return this.app.prisma.propertyUnit.findMany({
      where: {
        ...scopeWhere(access),
        ...(propertyId ? { propertyId } : {}),
        status: RecordStatus.ACTIVE,
        leases: { none: { status: LeaseStatus.ACTIVE } },
      },
      select: { id: true, name: true, unitNumber: true, monthlyRent: true, depositAmount: true, property: { select: { id: true, name: true } } },
      orderBy: [{ property: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  async create(access: LandlordAccess, input: LeaseCreateInput) {
    assertCan(access, 'leases.manage');
    const unit = await this.app.prisma.propertyUnit.findFirst({ where: { id: input.unitId, landlordId: access.landlordId } });
    if (!unit) throw new NotFoundError('Unit');
    assertProperty(access, unit.propertyId);

    if (input.endDate && input.endDate <= input.startDate) throw new UnprocessableError('End date must be after the start date.');
    const billFrom = input.billFrom ?? input.startDate;
    if (billFrom < input.startDate) throw new UnprocessableError('Billing cannot start before the lease does.');
    if (input.endDate && billFrom > input.endDate) throw new UnprocessableError('Billing start is after the lease ends.');

    const active = await this.app.prisma.lease.findFirst({ where: { unitId: unit.id, status: LeaseStatus.ACTIVE }, select: { code: true } });
    if (active) throw new ConflictError(`${unit.name} already has an active lease (${active.code}).`);

    if (input.tenantId) {
      const tenant = await this.app.prisma.landlordTenant.findFirst({ where: { id: input.tenantId, landlordId: access.landlordId }, select: { id: true } });
      if (!tenant) throw new NotFoundError('Tenant');
    } else if (!input.tenant) {
      throw new UnprocessableError('Choose an existing tenant or enter the new tenant’s details.');
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const lease = await this.app.prisma.$transaction(async (tx) => {
          const tenantId = input.tenantId ?? (await tx.landlordTenant.create({
            data: {
              landlordId: access.landlordId, propertyId: unit.propertyId, unitId: unit.id,
              name: input.tenant!.name, phone: input.tenant!.phone, email: input.tenant!.email ?? null, idNumber: input.tenant!.idNumber ?? null,
            },
          })).id;

          const created = await tx.lease.create({
            data: {
              code: newCode(),
              landlordId: access.landlordId, propertyId: unit.propertyId, unitId: unit.id, tenantId,
              rentAmount: input.rentAmount, depositAmount: input.depositAmount, billingFrequency: input.billingFrequency,
              dueDay: input.dueDay, startDate: input.startDate, endDate: input.endDate ?? null,
              nextBillingDate: billFrom, notes: input.notes, createdById: access.actorId,
            },
          });

          if (input.depositReceived && input.depositReceived.amount > 0) {
            await tx.ledgerEntry.create({
              data: {
                type: LedgerEntryType.DEPOSIT_RECEIVED, amount: input.depositReceived.amount,
                entryDate: input.depositReceived.date ?? todayNairobi(), method: input.depositReceived.method,
                reference: input.depositReceived.reference?.toUpperCase(), description: 'Deposit on move-in',
                landlordId: access.landlordId, propertyId: unit.propertyId, unitId: unit.id, leaseId: created.id, tenantId, createdById: access.actorId,
              },
            });
          }
          return created;
        });

        await this.app.auditLog.record({
          actorId: access.actorId, action: 'CREATE', subjectType: 'LEASE', subjectId: lease.id,
          summary: `Created lease ${lease.code} for ${unit.name} at KES ${input.rentAmount} ${input.billingFrequency.toLowerCase()}`, newValues: lease,
        });
        await this.billing.billLease(lease);
        return this.get(access, lease.id);
      } catch (err) {
        if (isUnique(err, 'code') && attempt < 4) continue; // lease code collision - draw again
        if (isUnique(err)) throw new ConflictError(`${unit.name} already has an active lease.`);
        throw err;
      }
    }
  }

  async update(access: LandlordAccess, id: string, input: LeaseUpdateInput) {
    assertCan(access, 'leases.manage');
    const lease = await this.ledger.ownedLease(access, id);
    if (lease.status !== LeaseStatus.ACTIVE) throw new UnprocessableError('Only active leases can be changed.');

    const data: Prisma.LeaseUncheckedUpdateInput = { ...input };
    if (input.endDate !== undefined) {
      if (input.endDate && input.endDate <= lease.startDate) throw new UnprocessableError('End date must be after the start date.');
      // Periods already billed can't be un-billed here - terminate (which credits unused days) instead.
      const lastBilledEnd = lease.nextBillingDate ? addDays(lease.nextBillingDate, -1) : null;
      if (input.endDate && lastBilledEnd && input.endDate < lastBilledEnd) {
        throw new UnprocessableError(`Rent is already billed to ${isoDate(lastBilledEnd)}. Use "End lease" to end it earlier.`);
      }
      if (input.endDate && lease.nextBillingDate && lease.nextBillingDate > input.endDate) data.nextBillingDate = null;
      if (!input.endDate && !lease.nextBillingDate) data.nextBillingDate = addDays(lease.endDate ?? todayNairobi(), 1);
    }

    const updated = await this.app.prisma.lease.update({ where: { id }, data });
    await this.app.auditLog.record({
      actorId: access.actorId, action: 'UPDATE', subjectType: 'LEASE', subjectId: id,
      summary: `Updated lease ${lease.code} (applies to future billing)`, oldValues: lease, newValues: updated,
    });
    return this.get(access, id);
  }

  /**
   * Ends a lease early: bills any periods up to the end date, credits rent
   * already charged for days after it, and stops billing.
   */
  async terminate(access: LandlordAccess, id: string, input: { endDate: Date; reason: string }) {
    assertCan(access, 'leases.manage');
    const lease = await this.ledger.ownedLease(access, id);
    if (lease.status !== LeaseStatus.ACTIVE) throw new UnprocessableError('This lease has already ended.');
    if (input.endDate < lease.startDate) throw new UnprocessableError('End date cannot be before the lease started.');

    const withEnd = await this.app.prisma.lease.update({ where: { id }, data: { endDate: input.endDate } });
    const today = todayNairobi();
    await this.billing.billLease(withEnd, input.endDate < today ? input.endDate : today);

    // Credit the unused part of any rent period that runs past the end date.
    const overlapping = await this.app.prisma.lease.findUnique({ where: { id } }).ledgerEntries({
      where: { type: LedgerEntryType.RENT_CHARGE, reversalOfId: null, reversedBy: null, periodEnd: { gt: input.endDate } },
    });
    let credited = 0;
    for (const charge of overlapping ?? []) {
      const start = charge.periodStart!;
      const covered = daysBetween(start, charge.periodEnd!) + 1;
      const unusedFrom = input.endDate < start ? start : addDays(input.endDate, 1);
      const unused = daysBetween(unusedFrom, charge.periodEnd!) + 1;
      const credit = round2((Number(charge.amount) * unused) / covered);
      if (credit <= 0) continue;
      await this.app.prisma.ledgerEntry.create({
        data: {
          type: LedgerEntryType.CREDIT, amount: credit, entryDate: today,
          description: `Unused rent ${isoDate(unusedFrom)} to ${isoDate(charge.periodEnd!)} after lease ended`,
          landlordId: lease.landlordId, propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: lease.tenantId, createdById: access.actorId,
        },
      });
      credited += credit;
    }

    await this.app.prisma.lease.update({
      where: { id },
      data: { status: LeaseStatus.TERMINATED, nextBillingDate: null, terminatedAt: new Date(), terminationReason: input.reason },
    });
    await this.app.auditLog.record({
      actorId: access.actorId, action: 'UPDATE', subjectType: 'LEASE', subjectId: id,
      summary: `Ended lease ${lease.code} on ${isoDate(input.endDate)} - ${input.reason}${credited ? ` (credited KES ${round2(credited)} unused rent)` : ''}`,
    });
    return this.get(access, id);
  }
}
