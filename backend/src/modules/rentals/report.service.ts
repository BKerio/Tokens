import { AppContext } from '../../context.js';
import { LeaseStatus, LedgerEntryType, RecordStatus } from '../../generated/prisma/index.js';
import { assertCan, propertyWhere, scopeWhere, type LandlordAccess } from './access.js';
import { monthlyEquivalent } from './billing.js';
import { LedgerService, emptyAging, round2, type Aging } from './ledger.service.js';

export type ReportGroup = 'property' | 'location';

export interface ReportRow {
  id: string;
  name: string;
  location: string | null;
  properties: number;
  units: number;
  occupied: number;
  vacant: number;
  occupancyRate: number | null;
  rentRoll: number;
  billed: number;
  collected: number;
  credits: number;
  collectionRate: number | null;
  expenses: number;
  net: number;
  arrears: number;
  aging: Aging;
  depositsHeld: number;
}

function blank(id: string, name: string, location: string | null): ReportRow {
  return {
    id, name, location, properties: 0, units: 0, occupied: 0, vacant: 0, occupancyRate: null, rentRoll: 0,
    billed: 0, collected: 0, credits: 0, collectionRate: null, expenses: 0, net: 0, arrears: 0, aging: emptyAging(), depositsHeld: 0,
  };
}

function add(into: ReportRow, r: ReportRow) {
  for (const k of ['properties', 'units', 'occupied', 'vacant', 'rentRoll', 'billed', 'collected', 'credits', 'expenses', 'arrears', 'depositsHeld'] as const) into[k] += r[k];
  for (const k of Object.keys(into.aging) as (keyof Aging)[]) into.aging[k] += r.aging[k];
}

function finish(r: ReportRow): ReportRow {
  for (const k of ['rentRoll', 'billed', 'collected', 'credits', 'expenses', 'arrears', 'depositsHeld'] as const) r[k] = round2(r[k]);
  for (const k of Object.keys(r.aging) as (keyof Aging)[]) r.aging[k] = round2(r.aging[k]);
  r.vacant = r.units - r.occupied;
  r.occupancyRate = r.units ? round2((r.occupied / r.units) * 100) : null;
  r.collectionRate = r.billed > 0 ? round2((r.collected / r.billed) * 100) : null;
  r.net = round2(r.collected - r.expenses);
  return r;
}

/** Property, location and portfolio reports over a date range (arrears and deposits are as of today). */
export class ReportService {
  private ledger: LedgerService;

  constructor(private app: AppContext) {
    this.ledger = new LedgerService(app);
  }

  async summary(access: LandlordAccess, f: { from: Date; to: Date; groupBy: ReportGroup }) {
    assertCan(access, 'reports.view');
    const scope = scopeWhere(access);

    const [properties, units, activeLeases, allLeases, periodSums, depositSums, expenseCats] = await Promise.all([
      this.app.prisma.property.findMany({ where: propertyWhere(access), select: { id: true, name: true, locationGroup: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } }),
      this.app.prisma.propertyUnit.groupBy({ by: ['propertyId'], where: { ...scope, status: RecordStatus.ACTIVE }, _count: { _all: true } }),
      this.app.prisma.lease.findMany({ where: { ...scope, status: LeaseStatus.ACTIVE }, select: { propertyId: true, rentAmount: true, billingFrequency: true } }),
      this.app.prisma.lease.findMany({ where: scope, select: { id: true, propertyId: true } }),
      this.app.prisma.ledgerEntry.groupBy({ by: ['propertyId', 'type'], where: { ...scope, entryDate: { gte: f.from, lte: f.to } }, _sum: { amount: true } }),
      this.app.prisma.ledgerEntry.groupBy({
        by: ['propertyId', 'type'],
        where: { ...scope, type: { in: [LedgerEntryType.DEPOSIT_RECEIVED, LedgerEntryType.DEPOSIT_REFUND, LedgerEntryType.DEPOSIT_APPLIED] } },
        _sum: { amount: true },
      }),
      this.app.prisma.ledgerEntry.groupBy({ by: ['category'], where: { ...scope, type: LedgerEntryType.EXPENSE, entryDate: { gte: f.from, lte: f.to } }, _sum: { amount: true } }),
    ]);

    const balances = await this.ledger.balances(allLeases.map((l) => l.id));

    const rows = new Map<string, ReportRow>(properties.map((p) => [p.id, blank(p.id, p.name, p.locationGroup?.name ?? null)]));
    for (const p of properties) rows.get(p.id)!.properties = 1;
    for (const u of units) { const r = rows.get(u.propertyId); if (r) r.units = u._count._all; }
    for (const l of activeLeases) {
      const r = rows.get(l.propertyId);
      if (!r) continue;
      r.occupied++;
      r.rentRoll += monthlyEquivalent(Number(l.rentAmount), l.billingFrequency);
    }
    for (const s of periodSums) {
      const r = rows.get(s.propertyId);
      if (!r) continue;
      const amt = Number(s._sum.amount ?? 0);
      if (s.type === LedgerEntryType.RENT_CHARGE || s.type === LedgerEntryType.OTHER_CHARGE) r.billed += amt;
      if (s.type === LedgerEntryType.PAYMENT) r.collected += amt;
      if (s.type === LedgerEntryType.CREDIT || s.type === LedgerEntryType.DEPOSIT_APPLIED) r.credits += amt;
      if (s.type === LedgerEntryType.EXPENSE) r.expenses += amt;
    }
    for (const s of depositSums) {
      const r = rows.get(s.propertyId);
      if (!r) continue;
      const amt = Number(s._sum.amount ?? 0);
      r.depositsHeld += s.type === LedgerEntryType.DEPOSIT_RECEIVED ? amt : -amt;
    }
    for (const l of allLeases) {
      const r = rows.get(l.propertyId);
      const b = balances.get(l.id);
      if (!r || !b) continue;
      r.arrears += b.arrears;
      for (const k of Object.keys(r.aging) as (keyof Aging)[]) r.aging[k] += b.aging[k];
    }

    const byProperty = [...rows.values()];
    let out: ReportRow[];
    if (f.groupBy === 'location') {
      const groups = new Map<string, ReportRow>();
      for (const p of properties) {
        const key = p.locationGroup?.id ?? 'none';
        const g = groups.get(key) ?? blank(key, p.locationGroup?.name ?? 'No location', null);
        add(g, rows.get(p.id)!);
        groups.set(key, g);
      }
      out = [...groups.values()].map(finish).sort((a, b) => (a.id === 'none' ? 1 : b.id === 'none' ? -1 : a.name.localeCompare(b.name)));
    } else {
      out = byProperty.map((r) => finish({ ...r, aging: { ...r.aging } }));
    }

    const totals = blank('total', 'Portfolio', null);
    for (const r of byProperty) add(totals, r);

    return {
      from: f.from.toISOString().slice(0, 10),
      to: f.to.toISOString().slice(0, 10),
      groupBy: f.groupBy,
      rows: out,
      totals: finish(totals),
      expensesByCategory: expenseCats
        .map((c) => ({ category: c.category ?? 'Uncategorised', amount: round2(Number(c._sum.amount ?? 0)) }))
        .filter((c) => c.amount !== 0)
        .sort((a, b) => b.amount - a.amount),
    };
  }
}
