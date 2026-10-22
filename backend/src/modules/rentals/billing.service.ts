import { AppContext } from '../../context.js';
import { Prisma, type Lease } from '../../generated/prisma/index.js';
import { LeaseStatus, LedgerEntryType } from '../../generated/prisma/index.js';
import { isoDate, periodFor, todayNairobi } from './billing.js';

/** Most periods posted for one lease in a single run (guards against a far-backdated lease). */
const MAX_CATCH_UP = 24;
const HOUR = 3_600_000;

export interface BillingRunResult { leases: number; charges: number; ended: number }

/**
 * Posts scheduled RENT_CHARGE entries. Each period's charge carries a unique
 * billingKey (`leaseId:periodStart`), so running this twice - or on two
 * servers at once - never double-charges.
 */
export class BillingService {
  constructor(private app: AppContext) {}

  /** Bills one lease up to `today`. Returns how many charges were posted. */
  async billLease(lease: Pick<Lease, 'id' | 'code' | 'landlordId' | 'propertyId' | 'unitId' | 'tenantId' | 'rentAmount' | 'billingFrequency' | 'dueDay' | 'endDate' | 'nextBillingDate'>, today = todayNairobi()): Promise<number> {
    let next = lease.nextBillingDate;
    let posted = 0;
    const terms = { rentAmount: Number(lease.rentAmount), billingFrequency: lease.billingFrequency, dueDay: lease.dueDay, endDate: lease.endDate };

    for (let i = 0; next && next <= today && i < MAX_CATCH_UP; i++) {
      const p = periodFor(terms, next);
      const billingKey = `${lease.id}:${isoDate(p.periodStart)}`;
      try {
        await this.app.prisma.$transaction([
          this.app.prisma.ledgerEntry.create({
            data: {
              type: LedgerEntryType.RENT_CHARGE,
              amount: p.amount,
              entryDate: p.periodStart,
              periodStart: p.periodStart,
              periodEnd: p.periodEnd,
              dueDate: p.dueDate,
              description: `Rent ${isoDate(p.periodStart)} to ${isoDate(p.periodEnd)}`,
              billingKey,
              landlordId: lease.landlordId,
              propertyId: lease.propertyId,
              unitId: lease.unitId,
              leaseId: lease.id,
              tenantId: lease.tenantId,
            },
          }),
          this.app.prisma.lease.update({ where: { id: lease.id }, data: { nextBillingDate: p.next } }),
        ]);
        posted++;
      } catch (err) {
        // Already billed (another run got there first) - just move the cursor on.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        await this.app.prisma.lease.update({ where: { id: lease.id }, data: { nextBillingDate: p.next } });
      }
      next = p.next;
    }
    return posted;
  }

  /** Bills every active lease that is due (optionally one landlord's), and closes leases past their end date. */
  async runDue(today = todayNairobi(), landlordId?: string): Promise<BillingRunResult> {
    const owner = landlordId ? { landlordId } : {};
    const due = await this.app.prisma.lease.findMany({
      where: { ...owner, status: LeaseStatus.ACTIVE, nextBillingDate: { lte: today } },
      orderBy: { nextBillingDate: 'asc' },
      take: 1000,
    });

    let charges = 0;
    for (const lease of due) {
      try {
        charges += await this.billLease(lease, today);
      } catch (err) {
        this.app.log.error({ err, leaseId: lease.id, code: lease.code }, 'Rent billing failed for lease');
      }
    }

    const expiring = await this.app.prisma.lease.findMany({
      where: { ...owner, status: LeaseStatus.ACTIVE, endDate: { lt: today }, nextBillingDate: null },
      select: { id: true, unitId: true, tenantId: true },
    });
    const ended = { count: 0 };
    for (const l of expiring) {
      // Fixed-term lease ran out: mark it ended and free the unit.
      await this.app.prisma.$transaction([
        this.app.prisma.lease.update({ where: { id: l.id }, data: { status: LeaseStatus.ENDED } }),
        this.app.prisma.propertyUnit.update({ where: { id: l.unitId }, data: { occupancy: 'VACANT' } }),
        this.app.prisma.landlordTenant.updateMany({ where: { id: l.tenantId, unitId: l.unitId }, data: { unitId: null } }),
      ]);
      ended.count++;
    }

    if (charges || ended.count) this.app.log.info({ leases: due.length, charges, ended: ended.count }, 'Rent billing run complete');
    return { leases: due.length, charges, ended: ended.count };
  }

  /** Runs shortly after boot, then hourly (cheap when nothing is due). */
  startScheduler(): () => void {
    const run = () => this.runDue().catch((err) => this.app.log.error({ err }, 'Rent billing run failed'));
    const first = setTimeout(run, 30_000);
    const timer = setInterval(run, HOUR);
    first.unref?.();
    timer.unref?.();
    return () => { clearTimeout(first); clearInterval(timer); };
  }
}
