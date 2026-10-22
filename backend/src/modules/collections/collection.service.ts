import { AppContext } from '../../context.js';
import type { Prisma } from '../../generated/prisma/index.js';
import { LedgerEntryType, PaymentMethod } from '../../generated/prisma/index.js';
import { PaymentStatus, TokenType, TransactionStatus } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { ROLE_PERMISSIONS, can, scopeWhere, type LandlordAccess } from '../rentals/access.js';
import { LedgerService } from '../rentals/ledger.service.js';
import { isoDate, todayNairobi } from '../rentals/billing.js';
import { VEND_METER_INCLUDE, VendingService } from '../tokens/vending.service.js';

/** Who is looking: admins see everything, vendors their meters, landlords their rent + meters. */
export type CollectionScope =
  | { kind: 'ADMIN'; userId: string }
  | { kind: 'VENDOR'; userId: string; vendorId: string }
  | { kind: 'LANDLORD'; userId: string; access: LandlordAccess };

export type Stream = 'RENT' | 'ELECTRICITY' | 'WATER' | 'OTHER' | 'UNASSIGNED';
/**
 * MATCHED  - token payment that issued a token
 * VERIFIED - rent payment whose M-Pesa receipt is in the payment feed
 * RECORDED - rent recorded by hand (cash/bank, or an M-Pesa receipt we never received)
 * EXCEPTION - money received that nothing was issued or allocated for
 * RESOLVED - an exception settled by a person (refund, write-off, manual vend)
 */
export type CollectionStatus = 'MATCHED' | 'VERIFIED' | 'RECORDED' | 'EXCEPTION' | 'RESOLVED' | 'PENDING' | 'FAILED';

export interface CollectionRow {
  id: string;
  kind: 'TOKEN' | 'RENT';
  stream: Stream;
  date: string;
  amount: number;
  channel: string;
  reference: string | null;
  payer: { name: string | null; phone: string | null };
  /** Meter number or lease code the money was for. */
  account: string | null;
  owner: string | null;
  place: string | null;
  status: CollectionStatus;
  reason: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  leaseId: string | null;
  /** For a paybill exception whose account reference is a lease code. */
  suggestion: { leaseId: string; code: string; tenantName: string; unitName: string; propertyName: string } | null;
  canAllocate: boolean;
  canVend: boolean;
  canResolve: boolean;
}

export interface CollectionFilters { from: Date; to: Date; stream?: Stream; status?: CollectionStatus[]; search?: string; page: number; limit: number }

const PAYMENT_INCLUDE = {
  meter: { select: { meterNumber: true, type: true, vendorId: true, landlordId: true, vendor: { select: { businessName: true } }, landlord: { select: { fullName: true } } } },
  tokenTransactions: { select: { status: true, tokenType: true } },
  resolvedBy: { select: { name: true } },
  lease: { select: { code: true } },
} satisfies Prisma.PaymentInclude;

const RENT_INCLUDE = {
  lease: { select: { id: true, code: true } },
  tenant: { select: { name: true, phone: true } },
  unit: { select: { name: true } },
  property: { select: { name: true } },
  landlord: { select: { fullName: true } },
} satisfies Prisma.LedgerEntryInclude;

const LEASE_REF = {
  id: true, code: true, tenant: { select: { name: true } }, unit: { select: { name: true } }, property: { select: { name: true } },
} satisfies Prisma.LeaseSelect;
type LeaseRef = Prisma.LeaseGetPayload<{ select: typeof LEASE_REF }>;

const CAP = 5000;
const streamOf = (type?: string | null): Stream => {
  const t = (type ?? '').toLowerCase();
  if (!type) return 'UNASSIGNED';
  return t === 'electricity' ? 'ELECTRICITY' : t === 'water' ? 'WATER' : 'OTHER';
};
/** "TILL#METER" → "METER". */
const refTail = (ref: string | null) => (ref?.includes('#') ? ref.split('#', 2)[1]!.trim() : ref?.trim() ?? '');

/**
 * Collections & reconciliation: every shilling received - token payments
 * (M-Pesa STK, C2B, NCBA paybill) and rent - with whether it was matched to
 * a token / lease, and tools to settle the ones that weren't.
 */
export class CollectionService {
  private ledger: LedgerService;
  private vending: VendingService;

  constructor(private app: AppContext) {
    this.ledger = new LedgerService(app);
    this.vending = new VendingService(app);
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** Active leases by upper-case code, for paybill payments that used a lease code as the account. */
  private async leasesByCode(where: Prisma.LeaseWhereInput): Promise<Map<string, LeaseRef>> {
    const leases = await this.app.prisma.lease.findMany({ where: { ...where, status: 'ACTIVE' }, select: LEASE_REF });
    return new Map(leases.map((l) => [l.code.toUpperCase(), l]));
  }

  private tokenWhere(scope: CollectionScope, from: Date, to: Date): Prisma.PaymentWhereInput {
    const base: Prisma.PaymentWhereInput = {
      createdAt: { gte: from, lt: to },
      // Allocated payments are shown as the rent entry they became. (NULL-safe: a bare NOT would drop unresolved rows.)
      OR: [{ resolution: null }, { resolution: { not: 'RENT_ALLOCATED' } }],
      amount: { gt: 0 },
    };
    if (scope.kind === 'ADMIN') return base;
    if (scope.kind === 'VENDOR') return { ...base, meter: { vendorId: scope.vendorId } };
    return can(scope.access, 'meters.view') ? { ...base, meter: { landlordId: scope.access.landlordId } } : { id: { in: [] } };
  }

  async list(scope: CollectionScope, f: CollectionFilters) {
    const to = new Date(f.to.getTime() + 86_400_000); // inclusive end day
    const showRent = scope.kind === 'ADMIN' || (scope.kind === 'LANDLORD' && can(scope.access, 'ledger.view'));

    const [payments, rentEntries, codes] = await Promise.all([
      this.app.prisma.payment.findMany({ where: this.tokenWhere(scope, f.from, to), include: PAYMENT_INCLUDE, orderBy: { createdAt: 'desc' }, take: CAP }),
      showRent
        ? this.app.prisma.ledgerEntry.findMany({
            where: {
              ...(scope.kind === 'LANDLORD' ? scopeWhere(scope.access) : {}),
              type: { in: [LedgerEntryType.PAYMENT, LedgerEntryType.DEPOSIT_RECEIVED] },
              reversalOfId: null,
              reversedBy: null,
              entryDate: { gte: todayNairobi(f.from), lte: todayNairobi(f.to) },
            },
            include: RENT_INCLUDE,
            orderBy: { entryDate: 'desc' },
            take: CAP,
          })
        : Promise.resolve([]),
      scope.kind === 'LANDLORD' ? this.leasesByCode(scopeWhere(scope.access)) : Promise.resolve(null),
    ]);

    // A landlord also sees unmatched paybill payments that used one of their lease codes.
    let suggested: typeof payments = [];
    if (scope.kind === 'LANDLORD' && codes && codes.size && can(scope.access, 'payments.record')) {
      const loose = await this.app.prisma.payment.findMany({
        where: { createdAt: { gte: f.from, lt: to }, status: PaymentStatus.CONFIRMED, meterId: null, resolution: null, amount: { gt: 0 } },
        include: PAYMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: CAP,
      });
      suggested = loose.filter((p) => codes.has(refTail(p.accountReference).toUpperCase()));
    }
    // Admins get the lease suggestion for any unmatched payment that used a lease code.
    const looseRefs = [...new Set(payments.filter((p) => !p.meterId && p.status === PaymentStatus.CONFIRMED).map((p) => refTail(p.accountReference).toUpperCase()).filter(Boolean))];
    const adminCodes = scope.kind === 'ADMIN' && looseRefs.length ? await this.leasesByCode({ code: { in: looseRefs } }) : null;

    const receipts = new Set(
      (await this.app.prisma.payment.findMany({
        where: { mpesaReceiptNumber: { in: rentEntries.map((e) => e.reference).filter((r): r is string => !!r) }, status: PaymentStatus.CONFIRMED },
        select: { mpesaReceiptNumber: true },
      })).map((p) => p.mpesaReceiptNumber!.toUpperCase()),
    );

    const isAdmin = scope.kind === 'ADMIN';
    const tokenRow = (p: (typeof payments)[number]): CollectionRow => {
      const issued = p.tokenTransactions.some((t) => t.status === TransactionStatus.SUCCESS && t.tokenType === TokenType.CREDIT);
      const vendFailed = p.tokenTransactions.some((t) => t.status === TransactionStatus.FAILED);
      let status: CollectionStatus;
      let reason: string | null = null;
      if (p.status === PaymentStatus.PENDING) status = 'PENDING';
      else if (p.status === PaymentStatus.FAILED) { status = 'FAILED'; reason = p.resultDesc; }
      else if (p.resolution) status = 'RESOLVED';
      else if (issued) status = 'MATCHED';
      else {
        status = 'EXCEPTION';
        reason = !p.meter ? `No meter matches “${p.accountReference ?? '-'}”` : vendFailed ? 'Token could not be issued' : 'No token issued yet';
      }
      const code = refTail(p.accountReference).toUpperCase();
      const lease = status === 'EXCEPTION' ? (codes?.get(code) ?? adminCodes?.get(code) ?? null) : null;
      const ownMeter = scope.kind === 'VENDOR' ? p.meter?.vendorId === scope.vendorId : scope.kind === 'LANDLORD' ? p.meter?.landlordId === scope.access.landlordId : true;
      return {
        id: p.id,
        kind: 'TOKEN',
        stream: streamOf(p.meter?.type),
        date: p.createdAt.toISOString(),
        amount: Number(p.amount),
        channel: p.channel === 'STK' ? 'M-Pesa STK' : p.channel === 'C2B' ? 'M-Pesa paybill' : 'NCBA paybill',
        reference: p.mpesaReceiptNumber,
        payer: { name: p.payerName, phone: p.phone === 'UNKNOWN' ? null : p.phone },
        account: p.meter?.meterNumber ?? p.accountReference,
        owner: p.meter?.vendor?.businessName ?? p.meter?.landlord?.fullName ?? null,
        place: null,
        status,
        reason,
        resolution: p.resolution,
        resolutionNote: p.resolutionNote,
        resolvedBy: p.resolvedBy?.name ?? null,
        resolvedAt: p.resolvedAt?.toISOString() ?? null,
        leaseId: p.leaseId,
        suggestion: lease ? { leaseId: lease.id, code: lease.code, tenantName: lease.tenant.name, unitName: lease.unit.name, propertyName: lease.property.name } : null,
        canAllocate: status === 'EXCEPTION' && (isAdmin || (scope.kind === 'LANDLORD' && can(scope.access, 'payments.record'))),
        canVend: status === 'EXCEPTION' && isAdmin,
        canResolve: status === 'EXCEPTION' && (isAdmin || ownMeter),
      };
    };

    const rentRow = (e: (typeof rentEntries)[number]): CollectionRow => {
      const verified = e.method === PaymentMethod.MPESA && !!e.reference && receipts.has(e.reference.toUpperCase());
      return {
        id: e.id,
        kind: 'RENT',
        stream: 'RENT',
        date: `${isoDate(e.entryDate)}T09:00:00.000Z`,
        amount: Number(e.amount),
        channel: `${e.type === LedgerEntryType.DEPOSIT_RECEIVED ? 'Deposit · ' : ''}${e.method === PaymentMethod.MPESA ? 'M-Pesa' : e.method ? e.method[0] + e.method.slice(1).toLowerCase() : 'Recorded'}`,
        reference: e.reference,
        payer: { name: e.tenant?.name ?? null, phone: e.tenant?.phone ?? null },
        account: e.lease?.code ?? null,
        owner: e.landlord.fullName,
        place: [e.unit?.name, e.property.name].filter(Boolean).join(' · '),
        status: verified ? 'VERIFIED' : 'RECORDED',
        reason: !verified && e.method === PaymentMethod.MPESA ? 'Receipt not found in the M-Pesa feed' : null,
        resolution: null, resolutionNote: e.description, resolvedBy: null, resolvedAt: null,
        leaseId: e.lease?.id ?? null,
        suggestion: null,
        canAllocate: false, canVend: false, canResolve: false,
      };
    };

    const seen = new Set(payments.map((p) => p.id));
    const all = [...payments.map(tokenRow), ...suggested.filter((p) => !seen.has(p.id)).map(tokenRow), ...rentEntries.map(rentRow)]
      .sort((a, b) => b.date.localeCompare(a.date));

    const summary = this.summarise(all, f.from, f.to);
    const q = f.search?.trim().toLowerCase();
    const rows = all.filter((r) => {
      if (f.stream && r.stream !== f.stream) return false;
      if (f.status?.length && !f.status.includes(r.status)) return false;
      if (!q) return true;
      return [r.reference, r.payer.name, r.payer.phone, r.account, r.owner, r.place].some((v) => v?.toLowerCase().includes(q));
    });
    const start = (f.page - 1) * f.limit;
    return {
      summary,
      data: rows.slice(start, start + f.limit),
      meta: { page: f.page, limit: f.limit, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / f.limit)) },
    };
  }

  private summarise(rows: CollectionRow[], from: Date, to: Date) {
    const received = rows.filter((r) => r.kind === 'RENT' || ['MATCHED', 'EXCEPTION', 'RESOLVED'].includes(r.status) && r.resolution !== 'REFUNDED');
    const sum = (list: CollectionRow[]) => Math.round(list.reduce((n, r) => n + r.amount, 0) * 100) / 100;
    const streams: Stream[] = ['RENT', 'ELECTRICITY', 'WATER', 'OTHER', 'UNASSIGNED'];
    const reconciled = received.filter((r) => ['MATCHED', 'VERIFIED', 'RESOLVED'].includes(r.status));
    const exceptions = rows.filter((r) => r.status === 'EXCEPTION');
    const manual = rows.filter((r) => r.status === 'RECORDED');
    const pending = rows.filter((r) => r.status === 'PENDING');

    const days: Record<string, Record<Stream, number>> = {};
    const span = Math.min(92, Math.round((todayNairobi(to).getTime() - todayNairobi(from).getTime()) / 86_400_000) + 1);
    for (let i = 0; i < span; i++) {
      const d = isoDate(new Date(todayNairobi(from).getTime() + i * 86_400_000));
      days[d] = { RENT: 0, ELECTRICITY: 0, WATER: 0, OTHER: 0, UNASSIGNED: 0 };
    }
    for (const r of received) {
      const d = isoDate(todayNairobi(new Date(r.date)));
      if (days[d]) days[d][r.stream] += r.amount;
    }
    const channels = new Map<string, { amount: number; count: number }>();
    for (const r of received) {
      const c = channels.get(r.channel) ?? { amount: 0, count: 0 };
      c.amount += r.amount; c.count++;
      channels.set(r.channel, c);
    }

    return {
      received: { amount: sum(received), count: received.length },
      reconciled: { amount: sum(reconciled), count: reconciled.length },
      exceptions: { amount: sum(exceptions), count: exceptions.length },
      manual: { amount: sum(manual), count: manual.length },
      pending: { amount: sum(pending), count: pending.length },
      failed: { count: rows.filter((r) => r.status === 'FAILED').length },
      matchRate: received.length ? Math.round((sum(reconciled) / Math.max(sum(received), 0.01)) * 1000) / 10 : 100,
      byStream: streams.map((s) => ({ stream: s, amount: sum(received.filter((r) => r.stream === s)), count: received.filter((r) => r.stream === s).length })),
      byChannel: [...channels.entries()].map(([channel, v]) => ({ channel, amount: Math.round(v.amount * 100) / 100, count: v.count })).sort((a, b) => b.amount - a.amount),
      daily: Object.entries(days).map(([date, v]) => ({ date, ...v })),
    };
  }

  /** Active leases to allocate a payment to: any for admins, the landlord's own (in scope) otherwise. */
  async searchLeases(scope: CollectionScope, search?: string) {
    if (scope.kind === 'VENDOR') return [];
    const q = search?.trim();
    const leases = await this.app.prisma.lease.findMany({
      where: {
        status: 'ACTIVE',
        ...(scope.kind === 'LANDLORD' ? scopeWhere(scope.access) : {}),
        ...(q ? { OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { tenant: { name: { contains: q, mode: 'insensitive' } } },
          { tenant: { phone: { contains: q } } },
          { unit: { name: { contains: q, mode: 'insensitive' } } },
        ] } : {}),
      },
      select: { ...LEASE_REF, rentAmount: true, landlord: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    return leases.map((l) => ({
      leaseId: l.id, code: l.code, tenantName: l.tenant.name, unitName: l.unit.name, propertyName: l.property.name,
      landlordName: l.landlord.fullName, rent: Number(l.rentAmount),
    }));
  }

  // ── Settling exceptions ────────────────────────────────────────────────────

  /** A confirmed payment with no token issued and no resolution yet. */
  private async openException(id: string) {
    const payment = await this.app.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundError('Payment');
    if (payment.status !== PaymentStatus.CONFIRMED) throw new UnprocessableError('Only confirmed payments can be reconciled.');
    if (payment.resolution) throw new UnprocessableError('This payment has already been reconciled.');
    if (payment.tokenTransactions.some((t) => t.status === TransactionStatus.SUCCESS && t.tokenType === TokenType.CREDIT)) {
      throw new UnprocessableError('A token was already issued for this payment.');
    }
    return payment;
  }

  /** Posts an unmatched paybill payment to a lease as rent. */
  async allocateToRent(scope: CollectionScope, paymentId: string, leaseId: string, note?: string) {
    if (scope.kind === 'VENDOR') throw new ForbiddenError('Only landlords and admins can allocate rent.');
    const payment = await this.openException(paymentId);
    const lease = await this.app.prisma.lease.findUnique({ where: { id: leaseId }, select: { landlordId: true, code: true, landlord: { select: { fullName: true } } } });
    if (!lease) throw new NotFoundError('Lease');

    const access: LandlordAccess = scope.kind === 'LANDLORD'
      ? scope.access
      : { landlordId: lease.landlordId, landlordName: lease.landlord.fullName, actorId: scope.userId, role: 'OWNER', permissions: new Set(ROLE_PERMISSIONS.OWNER), allProperties: true, propertyIds: [] };
    if (scope.kind === 'LANDLORD' && payment.meter && payment.meter.landlordId !== scope.access.landlordId) throw new ForbiddenError('This payment is not yours.');

    const entry = await this.ledger.recordPayment(access, leaseId, {
      amount: Number(payment.amount),
      date: todayNairobi(payment.createdAt),
      method: PaymentMethod.MPESA,
      reference: payment.mpesaReceiptNumber ?? undefined,
      description: `Paybill payment allocated in reconciliation${note ? ` - ${note}` : ''}`,
    });
    await this.app.prisma.payment.update({
      where: { id: paymentId },
      data: { resolution: 'RENT_ALLOCATED', leaseId, resolvedAt: new Date(), resolvedById: scope.userId, resolutionNote: note || null },
    });
    await this.app.auditLog.record({
      actorId: scope.userId, action: 'UPDATE', subjectType: 'PAYMENT', subjectId: paymentId,
      summary: `Allocated payment ${payment.mpesaReceiptNumber ?? paymentId} (KES ${payment.amount}) to lease ${lease.code}`,
    });
    return entry;
  }

  /** Admin: vend the payment's value to the meter it should have gone to. */
  async vendToMeter(scope: CollectionScope, paymentId: string, meterNumber: string) {
    if (scope.kind !== 'ADMIN') throw new ForbiddenError('Only admins can issue tokens from reconciliation.');
    const payment = await this.openException(paymentId);
    const meter = await this.app.prisma.meter.findUnique({ where: { meterNumber: meterNumber.trim() }, include: VEND_METER_INCLUDE });
    if (!meter) throw new UnprocessableError(`No meter ${meterNumber} is registered.`);

    const result = await this.vending.vendForPayment(payment, meter, 'Reconciliation');
    if (result.tokenGenerated) {
      await this.app.prisma.payment.update({
        where: { id: paymentId },
        data: { resolution: 'TOKEN_ISSUED', resolvedAt: new Date(), resolvedById: scope.userId, resolutionNote: `Vended to ${meter.meterNumber}` },
      });
    }
    await this.app.auditLog.record({
      actorId: scope.userId, action: 'UPDATE', subjectType: 'PAYMENT', subjectId: paymentId,
      summary: `${result.tokenGenerated ? 'Issued' : 'Tried to issue'} token for payment ${payment.mpesaReceiptNumber ?? paymentId} to meter ${meter.meterNumber}`,
    });
    if (!result.tokenGenerated) throw new UnprocessableError(result.error ? `Token could not be issued: ${result.error}` : 'Token could not be issued.');
    return result;
  }

  /** Marks an exception refunded or written off, with a note. */
  async resolve(scope: CollectionScope, paymentId: string, resolution: 'REFUNDED' | 'WRITTEN_OFF', note: string) {
    const payment = await this.openException(paymentId);
    if (scope.kind === 'VENDOR' && payment.meter?.vendorId !== scope.vendorId) throw new ForbiddenError('This payment is not for one of your meters.');
    if (scope.kind === 'LANDLORD' && payment.meter?.landlordId !== scope.access.landlordId) throw new ForbiddenError('This payment is not for one of your meters.');
    await this.app.prisma.payment.update({
      where: { id: paymentId },
      data: { resolution, resolutionNote: note, resolvedAt: new Date(), resolvedById: scope.userId },
    });
    await this.app.auditLog.record({
      actorId: scope.userId, action: 'UPDATE', subjectType: 'PAYMENT', subjectId: paymentId,
      summary: `Marked payment ${payment.mpesaReceiptNumber ?? paymentId} as ${resolution === 'REFUNDED' ? 'refunded' : 'written off'}: ${note}`,
    });
  }
}
