import { AppContext } from '../../context.js';
import { Prisma, PaymentMethod, RentClaimPurpose, RentClaimStatus, LeaseStatus, LedgerEntryType } from '../../generated/prisma/index.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';
import { assertCan, scopeWhere, type LandlordAccess } from './access.js';
import { daysBetween, todayNairobi } from './billing.js';
import { LedgerService } from './ledger.service.js';

/** M-Pesa receipts are 10 letters/digits, e.g. QJK7XB2LMN. */
export const MPESA_RECEIPT_RE = /^[A-Z0-9]{10}$/;
/** How far back a tenant may date a payment. */
const MAX_AGE_DAYS = 365;
/** Unreviewed claims a tenant may have open at once. */
const MAX_PENDING = 5;

const CLAIM_INCLUDE = {
  lease: { select: { id: true, code: true, unit: { select: { id: true, name: true } }, property: { select: { id: true, name: true } } } },
  tenant: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.RentPaymentClaimInclude;

export interface ClaimInput {
  purpose: RentClaimPurpose;
  method: typeof PaymentMethod.MPESA | typeof PaymentMethod.CASH;
  amount: number;
  paidOn: Date;
  reference?: string;
  note?: string;
}

const KES = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const purposeLabel = (p: RentClaimPurpose) => (p === RentClaimPurpose.DEPOSIT ? 'deposit' : 'rent');

function isUnique(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Payments a tenant reports from the tenant portal (M-Pesa with its receipt,
 * or cash). They stay out of the append-only ledger until the landlord - or
 * staff allowed to record payments - confirms them; confirming posts the
 * PAYMENT / DEPOSIT_RECEIVED entry through LedgerService, rejecting records
 * why. The tenant is SMS'd either way.
 */
export class RentClaimService {
  private ledger: LedgerService;

  constructor(private app: AppContext) {
    this.ledger = new LedgerService(app);
  }

  // ── Tenant side ────────────────────────────────────────────────────────────

  async submit(tenant: { id: string; name: string; landlordId: string }, leaseId: string, input: ClaimInput) {
    const lease = await this.app.prisma.lease.findFirst({
      where: { id: leaseId, tenantId: tenant.id },
      select: { id: true, code: true, status: true, landlordId: true, depositAmount: true },
    });
    if (!lease) throw new NotFoundError('Lease');
    if (input.purpose === RentClaimPurpose.DEPOSIT && lease.status !== LeaseStatus.ACTIVE) {
      throw new UnprocessableError('A deposit can only be paid on an active lease.');
    }

    const today = todayNairobi();
    if (input.paidOn.getTime() > today.getTime()) throw new UnprocessableError('The payment date cannot be in the future.');
    if (daysBetween(input.paidOn, today) > MAX_AGE_DAYS) throw new UnprocessableError('That payment is too old to report here - contact your landlord.');

    const reference = input.reference?.trim().toUpperCase() || undefined;
    if (input.method === PaymentMethod.MPESA) {
      if (!reference) throw new UnprocessableError('Enter the M-Pesa receipt number from your confirmation SMS.');
      if (!MPESA_RECEIPT_RE.test(reference)) throw new UnprocessableError('An M-Pesa receipt number is 10 letters and numbers, e.g. QJK7XB2LMN.');
    }

    if (reference) {
      const posted = await this.app.prisma.ledgerEntry.findFirst({
        where: {
          landlordId: lease.landlordId, reference: { equals: reference, mode: 'insensitive' },
          type: { in: [LedgerEntryType.PAYMENT, LedgerEntryType.DEPOSIT_RECEIVED] }, reversedBy: null, amount: { gt: 0 },
        },
        select: { id: true },
      });
      if (posted) throw new ConflictError(`Receipt ${reference} is already on your statement.`);
    }

    const open = await this.app.prisma.rentPaymentClaim.count({ where: { tenantId: tenant.id, status: RentClaimStatus.PENDING } });
    if (open >= MAX_PENDING) throw new UnprocessableError(`You have ${open} payments waiting for your landlord to confirm. Please wait for those first.`);

    let claim;
    try {
      claim = await this.app.prisma.rentPaymentClaim.create({
        data: {
          purpose: input.purpose, method: input.method, amount: input.amount, paidOn: input.paidOn, reference, note: input.note,
          landlordId: lease.landlordId, leaseId: lease.id, tenantId: tenant.id,
        },
        include: CLAIM_INCLUDE,
      });
    } catch (err) {
      if (isUnique(err)) throw new ConflictError(`Receipt ${reference} has already been reported.`);
      throw err;
    }

    await this.app.auditLog.record({
      actorId: null, action: 'CREATE', subjectType: 'LEDGER', subjectId: claim.id,
      summary: `Tenant ${tenant.name} reported a ${input.method === PaymentMethod.MPESA ? 'M-Pesa' : 'cash'} ${purposeLabel(input.purpose)} payment of KES ${KES(input.amount)}${reference ? ` (${reference})` : ''} on lease ${lease.code}`,
    });
    this.notifyLandlord(lease.landlordId);
    return claim;
  }

  /** The tenant's own reported payments, newest first. */
  listForTenant(tenantId: string) {
    return this.app.prisma.rentPaymentClaim.findMany({
      where: { tenantId }, include: CLAIM_INCLUDE, orderBy: { createdAt: 'desc' }, take: 30,
    });
  }

  // ── Landlord side ──────────────────────────────────────────────────────────

  async list(access: LandlordAccess, f: { status?: RentClaimStatus; page: number; limit: number }) {
    assertCan(access, 'ledger.view');
    const scope = scopeWhere(access) as Prisma.LeaseWhereInput;
    const where: Prisma.RentPaymentClaimWhereInput = { landlordId: access.landlordId, lease: scope };
    if (f.status) where.status = f.status;
    const [data, total, pending] = await Promise.all([
      this.app.prisma.rentPaymentClaim.findMany({
        where, include: CLAIM_INCLUDE,
        orderBy: f.status === RentClaimStatus.PENDING ? { createdAt: 'asc' } : { createdAt: 'desc' },
        ...paginate(f.page, f.limit),
      }),
      this.app.prisma.rentPaymentClaim.count({ where }),
      this.app.prisma.rentPaymentClaim.count({ where: { landlordId: access.landlordId, lease: scope, status: RentClaimStatus.PENDING } }),
    ]);
    return { data, meta: { ...pageMeta(total, f.page, f.limit), pending } };
  }

  private async owned(access: LandlordAccess, id: string) {
    const claim = await this.app.prisma.rentPaymentClaim.findUnique({
      where: { id },
      include: { ...CLAIM_INCLUDE, lease: { select: { ...CLAIM_INCLUDE.lease.select, propertyId: true } }, landlord: { select: { fullName: true, phone: true } } },
    });
    if (!claim || claim.landlordId !== access.landlordId) throw new NotFoundError('Reported payment');
    if (!access.allProperties && !access.propertyIds.includes(claim.lease.propertyId)) throw new NotFoundError('Reported payment');
    return claim;
  }

  /**
   * Posts the claim to the ledger. The claim is locked first so two reviewers
   * can't both post it; if posting fails (e.g. the receipt was recorded by
   * hand meanwhile) it goes back to PENDING and the error is shown.
   */
  async confirm(access: LandlordAccess, id: string, input: { amount?: number; date?: Date; note?: string }) {
    const claim = await this.owned(access, id);
    assertCan(access, claim.purpose === RentClaimPurpose.DEPOSIT ? 'deposits.manage' : 'payments.record');
    if (claim.status !== RentClaimStatus.PENDING) throw new ConflictError(`This payment was already ${claim.status.toLowerCase()}.`);

    const { count } = await this.app.prisma.rentPaymentClaim.updateMany({
      where: { id, status: RentClaimStatus.PENDING },
      data: { status: RentClaimStatus.CONFIRMED, reviewedById: access.actorId, reviewedAt: new Date(), reviewNote: input.note },
    });
    if (!count) throw new ConflictError('Someone else has just reviewed this payment.');

    const amount = input.amount ?? Number(claim.amount);
    const money = {
      amount,
      date: input.date ?? claim.paidOn,
      method: claim.method,
      reference: claim.reference ?? undefined,
      description: `Reported by tenant${claim.note ? `: ${claim.note}` : ''}`,
    };
    let entryId: string;
    try {
      const entry = claim.purpose === RentClaimPurpose.DEPOSIT
        ? await this.ledger.deposit(access, claim.leaseId, 'RECEIVED', money)
        : await this.ledger.recordPayment(access, claim.leaseId, money);
      entryId = entry.id;
    } catch (err) {
      await this.app.prisma.rentPaymentClaim.update({
        where: { id }, data: { status: RentClaimStatus.PENDING, reviewedById: null, reviewedAt: null, reviewNote: null },
      });
      throw err;
    }

    const updated = await this.app.prisma.rentPaymentClaim.update({ where: { id }, data: { ledgerEntryId: entryId, amount }, include: CLAIM_INCLUDE });
    const { balance, depositHeld } = await this.ledger.leaseBalance(claim.leaseId);
    const tail = claim.purpose === RentClaimPurpose.DEPOSIT
      ? `Deposit held: KES ${KES(depositHeld)}.`
      : balance > 0 ? `Balance due: KES ${KES(balance)}.` : balance < 0 ? `You are KES ${KES(-balance)} in credit.` : 'Your rent is fully paid.';
    void this.app.sms.send(
      claim.tenant.phone,
      `Hi ${claim.tenant.name.split(' ')[0]}, ${claim.landlord.fullName} confirmed your ${purposeLabel(claim.purpose)} payment of KES ${KES(amount)}${claim.reference ? ` (${claim.reference})` : ''} for ${claim.lease.unit.name}. ${tail}`,
    );
    return updated;
  }

  async reject(access: LandlordAccess, id: string, reason: string) {
    const claim = await this.owned(access, id);
    assertCan(access, claim.purpose === RentClaimPurpose.DEPOSIT ? 'deposits.manage' : 'payments.record');
    const { count } = await this.app.prisma.rentPaymentClaim.updateMany({
      where: { id, status: RentClaimStatus.PENDING },
      data: { status: RentClaimStatus.REJECTED, reviewedById: access.actorId, reviewedAt: new Date(), reviewNote: reason },
    });
    if (!count) throw new ConflictError('This payment has already been reviewed.');

    await this.app.auditLog.record({
      actorId: access.actorId, action: 'UPDATE', subjectType: 'LEDGER', subjectId: id,
      summary: `Rejected ${claim.tenant.name}'s reported ${purposeLabel(claim.purpose)} payment of KES ${KES(Number(claim.amount))}${claim.reference ? ` (${claim.reference})` : ''}: ${reason}`,
    });
    void this.app.sms.send(
      claim.tenant.phone,
      `Hi ${claim.tenant.name.split(' ')[0]}, ${claim.landlord.fullName} could not confirm your ${purposeLabel(claim.purpose)} payment of KES ${KES(Number(claim.amount))}${claim.reference ? ` (${claim.reference})` : ''}: ${reason}${claim.landlord.phone ? `. Call ${claim.landlord.phone}` : ''}.`,
    );
    return this.app.prisma.rentPaymentClaim.findUniqueOrThrow({ where: { id }, include: CLAIM_INCLUDE });
  }

  /** Live nudge for the landlord's open dashboards. */
  private notifyLandlord(landlordId: string) {
    void this.app.prisma.landlord
      .findUnique({ where: { id: landlordId }, select: { userId: true, staff: { select: { userId: true } } } })
      .then((l) => {
        if (!l) return;
        for (const userId of [l.userId, ...l.staff.map((s) => s.userId)]) this.app.io?.to(`user:${userId}`).emit('rent:claim', { landlordId });
      })
      .catch((err) => this.app.log.warn({ err }, 'Could not notify landlord of a reported payment'));
  }
}
