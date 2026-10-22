import { AppContext } from '../../context.js';
import { Prisma, type LedgerEntry } from '../../generated/prisma/index.js';
import { LeaseStatus, LedgerEntryType, PaymentMethod } from '../../generated/prisma/index.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';
import { assertCan, assertProperty, scopeWhere, type LandlordAccess } from './access.js';
import { daysBetween, todayNairobi } from './billing.js';

const CHARGES: LedgerEntryType[] = [LedgerEntryType.RENT_CHARGE, LedgerEntryType.OTHER_CHARGE];
const SETTLES: LedgerEntryType[] = [LedgerEntryType.PAYMENT, LedgerEntryType.CREDIT, LedgerEntryType.DEPOSIT_APPLIED];

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Aging { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number }

export interface LeaseBalance {
  charged: number;
  settled: number;
  /** charged - settled; negative means the tenant is in credit (prepaid). */
  balance: number;
  /** Unpaid charges whose due date has passed. */
  arrears: number;
  depositHeld: number;
  aging: Aging;
  oldestUnpaidDue: string | null;
}

export const emptyAging = (): Aging => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });

function emptyBalance(): LeaseBalance {
  return { charged: 0, settled: 0, balance: 0, arrears: 0, depositHeld: 0, aging: emptyAging(), oldestUnpaidDue: null };
}

const ENTRY_INCLUDE = {
  lease: { select: { id: true, code: true } },
  tenant: { select: { id: true, name: true, phone: true } },
  unit: { select: { id: true, name: true } },
  property: { select: { id: true, name: true } },
} satisfies Prisma.LedgerEntryInclude;

const TYPE_LABEL: Record<LedgerEntryType, string> = {
  RENT_CHARGE: 'Rent charge', OTHER_CHARGE: 'Charge', PAYMENT: 'Payment', CREDIT: 'Credit',
  DEPOSIT_RECEIVED: 'Deposit received', DEPOSIT_REFUND: 'Deposit refund', DEPOSIT_APPLIED: 'Deposit applied', EXPENSE: 'Expense',
};

function isUnique(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export interface MoneyInput { amount: number; date: Date; method?: PaymentMethod; reference?: string; description?: string }

/**
 * The rent ledger: append-only money entries per lease/property, and the
 * balances, arrears and deposits derived from them.
 */
export class LedgerService {
  constructor(private app: AppContext) {}

  // ── Balances ───────────────────────────────────────────────────────────────

  /**
   * Balance, arrears (FIFO-aged) and deposit held for each lease. Payments,
   * credits and applied deposits settle the oldest charges first.
   */
  async balances(leaseIds: string[], today = todayNairobi()): Promise<Map<string, LeaseBalance>> {
    const out = new Map<string, LeaseBalance>(leaseIds.map((id) => [id, emptyBalance()]));
    if (!leaseIds.length) return out;

    const [sums, charges] = await Promise.all([
      this.app.prisma.ledgerEntry.groupBy({ by: ['leaseId', 'type'], where: { leaseId: { in: leaseIds } }, _sum: { amount: true } }),
      this.app.prisma.ledgerEntry.findMany({
        where: { leaseId: { in: leaseIds }, type: { in: CHARGES } },
        select: { leaseId: true, amount: true, dueDate: true, entryDate: true },
      }),
    ]);

    for (const s of sums) {
      const b = out.get(s.leaseId!)!;
      const amt = Number(s._sum.amount ?? 0);
      if (CHARGES.includes(s.type)) b.charged += amt;
      if (SETTLES.includes(s.type)) b.settled += amt;
      if (s.type === LedgerEntryType.DEPOSIT_RECEIVED) b.depositHeld += amt;
      if (s.type === LedgerEntryType.DEPOSIT_REFUND || s.type === LedgerEntryType.DEPOSIT_APPLIED) b.depositHeld -= amt;
    }

    // Net charges per (lease, due day) - reversals carry the original due date, so they cancel out here.
    const byLease = new Map<string, Map<number, number>>();
    for (const c of charges) {
      const due = (c.dueDate ?? c.entryDate).getTime();
      const m = byLease.get(c.leaseId!) ?? new Map<number, number>();
      m.set(due, (m.get(due) ?? 0) + Number(c.amount));
      byLease.set(c.leaseId!, m);
    }

    for (const [leaseId, b] of out) {
      b.charged = round2(b.charged);
      b.settled = round2(b.settled);
      b.balance = round2(b.charged - b.settled);
      b.depositHeld = round2(b.depositHeld);

      let credit = b.settled;
      const dues = [...(byLease.get(leaseId) ?? new Map()).entries()].filter(([, a]) => a > 0.004).sort(([x], [y]) => x - y);
      for (const [dueMs, amount] of dues) {
        const applied = Math.min(credit, amount);
        credit -= applied;
        const unpaid = round2(amount - applied);
        if (unpaid <= 0) continue;
        const late = daysBetween(new Date(dueMs), today);
        if (late <= 0) b.aging.current += unpaid;
        else {
          b.arrears += unpaid;
          b.oldestUnpaidDue ??= new Date(dueMs).toISOString().slice(0, 10);
          if (late <= 30) b.aging.d1_30 += unpaid;
          else if (late <= 60) b.aging.d31_60 += unpaid;
          else if (late <= 90) b.aging.d61_90 += unpaid;
          else b.aging.d90plus += unpaid;
        }
      }
      b.arrears = round2(b.arrears);
      for (const k of Object.keys(b.aging) as (keyof Aging)[]) b.aging[k] = round2(b.aging[k]);
    }
    return out;
  }

  async leaseBalance(leaseId: string) {
    return (await this.balances([leaseId])).get(leaseId)!;
  }

  // ── Listing ────────────────────────────────────────────────────────────────

  async list(access: LandlordAccess, f: {
    type?: LedgerEntryType; propertyId?: string; leaseId?: string; from?: Date; to?: Date; search?: string; page: number; limit: number;
  }) {
    assertCan(access, 'ledger.view');
    if (f.propertyId) assertProperty(access, f.propertyId);
    const where: Prisma.LedgerEntryWhereInput = { ...scopeWhere(access) };
    if (f.type) where.type = f.type;
    if (f.propertyId) where.propertyId = f.propertyId;
    if (f.leaseId) where.leaseId = f.leaseId;
    if (f.from || f.to) where.entryDate = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
    if (f.search) {
      where.OR = [
        { reference: { contains: f.search, mode: 'insensitive' } },
        { description: { contains: f.search, mode: 'insensitive' } },
        { tenant: { name: { contains: f.search, mode: 'insensitive' } } },
        { lease: { code: { contains: f.search, mode: 'insensitive' } } },
      ];
    }
    const [data, total] = await Promise.all([
      this.app.prisma.ledgerEntry.findMany({
        where, include: { ...ENTRY_INCLUDE, reversedBy: { select: { id: true } } },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], ...paginate(f.page, f.limit),
      }),
      this.app.prisma.ledgerEntry.count({ where }),
    ]);
    return { data: data.map((e) => ({ ...e, reversed: !!e.reversedBy, reversedBy: undefined })), meta: pageMeta(total, f.page, f.limit) };
  }

  /** Chronological statement for one lease with a running balance (deposits shown separately). */
  async statement(access: LandlordAccess, leaseId: string) {
    assertCan(access, 'ledger.view');
    const lease = await this.ownedLease(access, leaseId);
    const entries = await this.app.prisma.ledgerEntry.findMany({
      where: { leaseId }, orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }], include: { reversedBy: { select: { id: true } } },
    });
    let running = 0;
    let deposit = 0;
    const rows = entries.map((e) => {
      const amt = Number(e.amount);
      if (CHARGES.includes(e.type)) running += amt;
      if (SETTLES.includes(e.type)) running -= amt;
      if (e.type === LedgerEntryType.DEPOSIT_RECEIVED) deposit += amt;
      if (e.type === LedgerEntryType.DEPOSIT_REFUND || e.type === LedgerEntryType.DEPOSIT_APPLIED) deposit -= amt;
      return { ...e, reversed: !!e.reversedBy, reversedBy: undefined, balance: round2(running), depositHeld: round2(deposit) };
    });
    return { lease, entries: rows, summary: await this.leaseBalance(leaseId) };
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  async ownedLease(access: LandlordAccess, leaseId: string) {
    const lease = await this.app.prisma.lease.findUnique({
      where: { id: leaseId },
      include: { tenant: true, unit: { select: { id: true, name: true } }, property: { select: { id: true, name: true } } },
    });
    if (!lease || lease.landlordId !== access.landlordId) throw new NotFoundError('Lease');
    assertProperty(access, lease.propertyId);
    return lease;
  }

  private async create(access: LandlordAccess, data: Omit<Prisma.LedgerEntryUncheckedCreateInput, 'landlordId'>, summary: string) {
    let entry: LedgerEntry;
    try {
      entry = await this.app.prisma.ledgerEntry.create({ data: { ...data, landlordId: access.landlordId, createdById: access.actorId } });
    } catch (err) {
      if (isUnique(err)) throw new ConflictError('That entry has already been recorded.');
      throw err;
    }
    await this.app.auditLog.record({ actorId: access.actorId, action: 'CREATE', subjectType: 'LEDGER', subjectId: entry.id, summary, newValues: entry });
    return entry;
  }

  private async assertReferenceUnused(access: LandlordAccess, reference: string | undefined, method: PaymentMethod | undefined) {
    if (!reference || method !== PaymentMethod.MPESA) return;
    const dup = await this.app.prisma.ledgerEntry.findFirst({
      where: { landlordId: access.landlordId, reference: { equals: reference, mode: 'insensitive' }, type: { in: [LedgerEntryType.PAYMENT, LedgerEntryType.DEPOSIT_RECEIVED] }, reversedBy: null, amount: { gt: 0 } },
      select: { id: true },
    });
    if (dup) throw new ConflictError(`M-Pesa receipt ${reference.toUpperCase()} has already been recorded.`);
  }

  async recordPayment(access: LandlordAccess, leaseId: string, input: MoneyInput) {
    assertCan(access, 'payments.record');
    const lease = await this.ownedLease(access, leaseId);
    await this.assertReferenceUnused(access, input.reference, input.method);
    return this.create(access, {
      type: LedgerEntryType.PAYMENT, amount: input.amount, entryDate: input.date, method: input.method ?? PaymentMethod.CASH,
      reference: input.reference?.toUpperCase(), description: input.description,
      propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: lease.tenantId,
    }, `Payment KES ${input.amount} for lease ${lease.code} (${lease.tenant.name})`);
  }

  async addCharge(access: LandlordAccess, leaseId: string, input: MoneyInput & { dueDate?: Date; category?: string }) {
    assertCan(access, 'charges.manage');
    const lease = await this.ownedLease(access, leaseId);
    return this.create(access, {
      type: LedgerEntryType.OTHER_CHARGE, amount: input.amount, entryDate: input.date, dueDate: input.dueDate ?? input.date,
      category: input.category, description: input.description,
      propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: lease.tenantId,
    }, `Charge KES ${input.amount} (${input.category ?? 'other'}) on lease ${lease.code}`);
  }

  async addCredit(access: LandlordAccess, leaseId: string, input: MoneyInput) {
    assertCan(access, 'charges.manage');
    const lease = await this.ownedLease(access, leaseId);
    return this.create(access, {
      type: LedgerEntryType.CREDIT, amount: input.amount, entryDate: input.date, description: input.description,
      propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: lease.tenantId,
    }, `Credit KES ${input.amount} on lease ${lease.code}`);
  }

  async deposit(access: LandlordAccess, leaseId: string, action: 'RECEIVED' | 'REFUND' | 'APPLIED', input: MoneyInput) {
    assertCan(access, 'deposits.manage');
    const lease = await this.ownedLease(access, leaseId);
    if (action !== 'RECEIVED') {
      const { depositHeld } = await this.leaseBalance(lease.id);
      if (input.amount > depositHeld + 0.004) throw new UnprocessableError(`Only KES ${depositHeld.toLocaleString()} of deposit is held for this lease.`);
    } else {
      await this.assertReferenceUnused(access, input.reference, input.method);
    }
    const type = action === 'RECEIVED' ? LedgerEntryType.DEPOSIT_RECEIVED : action === 'REFUND' ? LedgerEntryType.DEPOSIT_REFUND : LedgerEntryType.DEPOSIT_APPLIED;
    return this.create(access, {
      type, amount: input.amount, entryDate: input.date, method: action === 'APPLIED' ? undefined : input.method,
      reference: input.reference?.toUpperCase(), description: input.description,
      propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: lease.tenantId,
    }, `${TYPE_LABEL[type]} KES ${input.amount} on lease ${lease.code}`);
  }

  async addExpense(access: LandlordAccess, input: MoneyInput & { propertyId: string; unitId?: string; category: string }) {
    assertCan(access, 'expenses.manage');
    assertProperty(access, input.propertyId);
    const property = await this.app.prisma.property.findFirst({ where: { id: input.propertyId, landlordId: access.landlordId }, select: { id: true, name: true } });
    if (!property) throw new NotFoundError('Property');
    if (input.unitId) {
      const unit = await this.app.prisma.propertyUnit.findFirst({ where: { id: input.unitId, propertyId: property.id }, select: { id: true } });
      if (!unit) throw new NotFoundError('Unit');
    }
    return this.create(access, {
      type: LedgerEntryType.EXPENSE, amount: input.amount, entryDate: input.date, method: input.method, category: input.category,
      reference: input.reference, description: input.description, propertyId: property.id, unitId: input.unitId,
    }, `Expense KES ${input.amount} (${input.category}) at ${property.name}`);
  }

  /** Corrects an entry by posting its negative. The original is kept, so history stays intact. */
  async reverse(access: LandlordAccess, entryId: string, reason: string) {
    assertCan(access, 'entries.reverse');
    const original = await this.app.prisma.ledgerEntry.findUnique({ where: { id: entryId }, include: { reversedBy: { select: { id: true } } } });
    if (!original || original.landlordId !== access.landlordId) throw new NotFoundError('Entry');
    assertProperty(access, original.propertyId);
    if (original.reversalOfId) throw new UnprocessableError('A reversal cannot itself be reversed.');
    if (original.reversedBy) throw new ConflictError('This entry has already been reversed.');

    if (original.type === LedgerEntryType.DEPOSIT_RECEIVED && original.leaseId) {
      const { depositHeld } = await this.leaseBalance(original.leaseId);
      if (Number(original.amount) > depositHeld + 0.004) throw new UnprocessableError('Part of this deposit has already been refunded or applied - reverse those first.');
    }

    return this.create(access, {
      type: original.type,
      amount: -Number(original.amount),
      entryDate: todayNairobi(),
      periodStart: original.periodStart, periodEnd: original.periodEnd, dueDate: original.dueDate,
      method: original.method, reference: original.reference, category: original.category,
      description: `Reversal: ${reason}`,
      reversalOfId: original.id,
      propertyId: original.propertyId, unitId: original.unitId, leaseId: original.leaseId, tenantId: original.tenantId,
    }, `Reversed ${TYPE_LABEL[original.type].toLowerCase()} KES ${original.amount} - ${reason}`);
  }

  /** Leases with arrears for dashboards (largest first). */
  async arrearsList(access: LandlordAccess, limit = 10) {
    assertCan(access, 'ledger.view');
    const leases = await this.app.prisma.lease.findMany({
      where: { ...scopeWhere(access), status: { in: [LeaseStatus.ACTIVE, LeaseStatus.ENDED, LeaseStatus.TERMINATED] } },
      select: { id: true, code: true, status: true, tenant: { select: { name: true, phone: true } }, unit: { select: { name: true } }, property: { select: { name: true } } },
    });
    const balances = await this.balances(leases.map((l) => l.id));
    return leases
      .map((l) => ({ ...l, ...balances.get(l.id)! }))
      .filter((l) => l.arrears > 0)
      .sort((a, b) => b.arrears - a.arrears)
      .slice(0, limit);
  }
}
