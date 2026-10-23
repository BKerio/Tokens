import { AppContext } from '../../context.js';
import { LeaseStatus, RentClaimPurpose } from '../../generated/prisma/index.js';
import { ConflictError, UnprocessableError } from '../../shared/errors/AppError.js';
import { PaymentChannel, PaymentStatus } from '../../shared/types/index.js';
import { MpesaPaymentService } from '../mpesa/mpesa.service.js';
import { assertCan, type LandlordAccess } from './access.js';
import { LedgerService } from './ledger.service.js';

/** One prompt at a time per lease: a second push while the first is on the phone fails anyway ("Duplicated MSISDN"). */
const PROMPT_WINDOW_MS = 2 * 60_000;
/** Safaricom's per-transaction ceiling. */
export const STK_MAX_AMOUNT = 250_000;

/**
 * "Request payment": the landlord - or a manager, accountant or caretaker -
 * sends the tenant an M-Pesa prompt for rent or deposit. Confirmed prompts are
 * posted to the lease by MpesaPaymentService.
 */
export class RentStkService {
  private ledger: LedgerService;
  private mpesa: MpesaPaymentService;

  constructor(private app: AppContext) {
    this.ledger = new LedgerService(app);
    this.mpesa = new MpesaPaymentService(app);
  }

  async request(access: LandlordAccess, leaseId: string, input: { purpose: RentClaimPurpose; amount: number; phone?: string }) {
    assertCan(access, input.purpose === RentClaimPurpose.DEPOSIT ? 'deposits.manage' : 'payments.record');
    const lease = await this.ledger.ownedLease(access, leaseId);
    if (lease.status !== LeaseStatus.ACTIVE && input.purpose === RentClaimPurpose.DEPOSIT) {
      throw new UnprocessableError('A deposit can only be requested on an active lease.');
    }
    if (input.amount > STK_MAX_AMOUNT) throw new UnprocessableError(`M-Pesa allows at most KES ${STK_MAX_AMOUNT.toLocaleString()} per prompt.`);

    const recent = await this.app.prisma.payment.findFirst({
      where: { leaseId, channel: PaymentChannel.STK, status: PaymentStatus.PENDING, createdAt: { gte: new Date(Date.now() - PROMPT_WINDOW_MS) } },
      select: { id: true },
    });
    if (recent) throw new ConflictError('A prompt was just sent to this tenant. Wait for them to answer it (about 2 minutes) before sending another.');

    const result = await this.mpesa.stkPushForLease({
      leaseId: lease.id, leaseCode: lease.code, landlordId: lease.landlordId, purpose: input.purpose,
      phone: input.phone?.trim() || lease.tenant.phone, amount: input.amount, initiatedById: access.actorId,
    });

    await this.app.auditLog.record({
      actorId: access.actorId, action: 'CREATE', subjectType: 'PAYMENT', subjectId: result.checkoutRequestId,
      summary: `Sent an M-Pesa prompt for ${input.purpose === RentClaimPurpose.DEPOSIT ? 'deposit' : 'rent'} KES ${input.amount} to ${lease.tenant.name} (${result.phone}) on lease ${lease.code}`,
    });
    return { ...result, tenant: { name: lease.tenant.name }, lease: { code: lease.code, unit: lease.unit.name, property: lease.property.name } };
  }
}
