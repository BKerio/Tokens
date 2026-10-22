import { AppContext } from '../../context.js';
import { Prisma, type Payment } from '../../generated/prisma/index.js';
import { PaymentChannel, PaymentStatus } from '../../shared/types/index.js';
import { ConflictError } from '../../shared/errors/AppError.js';
import { normalizeMsisdn } from '../../shared/utils/phone.js';
import { tokenStrings, type IssuedToken } from '../../integrations/prism/prism.client.js';
import { VEND_METER_INCLUDE, VendingService, type VendMeter } from '../tokens/vending.service.js';

/**
 * Port of the live Laravel `App\Services\NcbaPaymentService`.
 *
 * A paybill payment (NCBA webhook or Safaricom C2B) is stored, vended into
 * STS tokens through Prism when its meter is known, and the payer is SMS'd
 * either the token or a plain payment confirmation.
 */

/** Paybill notification after key normalization (NCBA and C2B share this shape). */
export interface PaybillPayload {
  TransID: string;
  TransAmount: string | number;
  BillRefNumber?: string | null;
  Narrative?: string | null;
  Mobile?: string | null;
  MSISDN?: string | null;
  name?: string | null;
  FirstName?: string | null;
  BusinessShortCode?: string | null;
}

export type PaybillChannel = typeof PaymentChannel.NCBA | typeof PaymentChannel.C2B;

/** The legacy `processPayment()` result array, plus `duplicate` for the race-safe insert. */
export type ProcessPaymentResult =
  | { duplicate: true }
  | {
      duplicate: false;
      paymentId: string;
      meterFound: boolean;
      tokenGenerated: boolean;
      tokens?: string[];
      smsSent: boolean;
      error?: string;
    };

/** Admin entry for a payment whose webhook never arrived (the legacy `php artisan ncba:process-payment`). */
export interface ManualNcbaPaymentInput {
  transId: string;
  amount: number;
  phone: string;
  meterNumber: string;
  till?: string;
  name?: string;
}

export interface ResolvedAccountRef {
  meter: VendMeter | null;
  tillNumber: string | null;
  meterNumber: string | null;
  accountRef: string | null;
}

/**
 * Splits a paybill account reference into till + meter (pure, no DB).
 * NCBA usually puts the till in BillRefNumber and the meter in Narrative;
 * either field may instead carry the combined "TILL#METER" form.
 */
export function splitAccountRef(billRefNumber?: string | null, narrative?: string | null) {
  const bill = billRefNumber?.trim() || null;
  const narr = narrative?.trim() || null;
  let tillNumber: string | null = null;
  let meterNumber: string | null = null;

  for (const ref of [bill, narr]) {
    if (ref?.includes('#')) {
      const [till, meter] = ref.split('#', 2);
      tillNumber = till?.trim() || null;
      meterNumber = meter?.trim() || null;
      break;
    }
  }

  if (!meterNumber && bill && narr) {
    tillNumber = bill;
    meterNumber = narr;
  } else if (!meterNumber && bill) {
    meterNumber = bill;
  } else if (!meterNumber && narr) {
    meterNumber = narr;
  }

  const accountRef = tillNumber && meterNumber ? `${tillNumber}#${meterNumber}` : meterNumber ?? bill ?? narr;
  return { tillNumber, meterNumber, accountRef };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export class NcbaPaymentService {
  private vending: VendingService;

  constructor(private app: AppContext) {
    this.vending = new VendingService(app);
  }

  /** Process a paybill payment: store record, vend token, send SMS. */
  async processPayment(data: PaybillPayload, channel: PaybillChannel = PaymentChannel.NCBA, actorId: string | null = null): Promise<ProcessPaymentResult> {
    const label = channel === PaymentChannel.NCBA ? 'NCBA' : 'C2B';
    const transID = data.TransID;
    const transAmount = Math.round(Number(data.TransAmount) * 100) / 100;
    const billRef = data.BillRefNumber ?? null;
    const narrative = data.Narrative ?? null;
    const rawMobile = String(data.Mobile ?? data.MSISDN ?? '');
    const mobile = normalizeMsisdn(rawMobile) ?? rawMobile;
    const customerName = data.name ?? data.FirstName ?? 'Customer';

    const resolved = await this.resolveMeterFromAccountRef(billRef, narrative);
    const { meter } = resolved;
    const meterRef = resolved.accountRef;

    this.app.log.info(
      { billRef, narrative, tillNumber: resolved.tillNumber, meterNumber: resolved.meterNumber, accountRef: meterRef, meterFound: !!meter },
      `${label}: Resolved account reference`,
    );

    // The unique index on mpesa_receipt_number makes the TransID the idempotency
    // key: a concurrent retry of the same notification loses this insert.
    let payment: Payment;
    try {
      payment = await this.app.prisma.payment.create({
        data: {
          channel,
          status: PaymentStatus.CONFIRMED,
          merchantRequestId: null,
          checkoutRequestId: `${channel}-${transID}`,
          accountReference: meterRef ?? billRef,
          phone: mobile,
          amount: transAmount,
          mpesaReceiptNumber: transID,
          resultCode: '0',
          resultDesc: `${label} Paybill Payment`,
          payerName: customerName,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.app.log.info({ transID }, `${label}: duplicate TransID ignored`);
        return { duplicate: true };
      }
      throw err;
    }
    await this.audit(payment, actorId);

    if (!meter) {
      this.app.log.warn({ billRef, narrative, paymentId: payment.id }, `${label}: Meter not found for payment`);
      const smsSent = await this.vending.sendPaymentConfirmation(payment);
      return { duplicate: false, paymentId: payment.id, meterFound: false, tokenGenerated: false, smsSent };
    }

    this.app.log.info({ meterId: meter.id, amount: transAmount, paymentId: payment.id }, `${label}: Vending token`);
    // Prism vend + TokenTransaction (success or failed) + token SMS, or the
    // plain confirmation SMS when Prism fails. Never throws.
    const vend = await this.vending.vendForPayment(payment, meter, `${label} Paybill`);
    this.app.log.info({ transID, paymentId: payment.id }, `${label}: Token SMS ${vend.smsSent ? 'sent' : 'FAILED'}`);

    return { duplicate: false, paymentId: payment.id, meterFound: true, ...vend };
  }

  /** Safaricom C2B confirmation → the shared paybill shape ("TILL#METER" split into BillRef / Narrative). */
  normalizeC2bPayload(data: Record<string, unknown>): PaybillPayload {
    const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
    let billRef = str(data.BillRefNumber);
    let narrative: string | null = null;

    if (billRef?.includes('#')) {
      const [till, meter] = billRef.split('#', 2);
      billRef = till?.trim() ?? null;
      narrative = meter?.trim() ?? null;
    }

    return {
      TransID: str(data.TransID) ?? '',
      TransAmount: str(data.TransAmount) ?? '',
      BillRefNumber: billRef,
      Narrative: narrative,
      Mobile: str(data.MSISDN) ?? str(data.Mobile),
      FirstName: str(data.FirstName) ?? 'Customer',
      BusinessShortCode: str(data.BusinessShortCode),
    };
  }

  async isDuplicate(transID: string): Promise<boolean> {
    return (await this.app.prisma.payment.count({ where: { mpesaReceiptNumber: transID } })) > 0;
  }

  /** Till + meter from the account reference, the meter record, and a warning when the till isn't the meter vendor's. */
  async resolveMeterFromAccountRef(billRefNumber?: string | null, narrative?: string | null): Promise<ResolvedAccountRef> {
    const { tillNumber, meterNumber, accountRef } = splitAccountRef(billRefNumber, narrative);

    let meter: VendMeter | null = null;
    if (meterNumber) {
      meter = await this.app.prisma.meter.findUnique({ where: { meterNumber }, include: VEND_METER_INCLUDE });

      if (meter && tillNumber && meter.vendorId) {
        const vendor = await this.app.prisma.vendor.findUnique({ where: { id: meter.vendorId }, select: { accountId: true } });
        const vendorTill = vendor?.accountId?.trim() ?? '';
        if (vendorTill !== '' && vendorTill !== tillNumber) {
          this.app.log.warn({ expectedTill: vendorTill, receivedTill: tillNumber, meterNumber }, 'NCBA: Till number does not match meter vendor');
        }
      }
    }

    return { meter, tillNumber, meterNumber, accountRef };
  }

  /** Prism tokens → display strings (decimal, falling back to hex). */
  extractTokenStrings(generatedTokens: IssuedToken[]): string[] {
    return tokenStrings(generatedTokens);
  }

  /** Admin: record + vend an NCBA payment that never arrived by webhook. */
  async processManualPayment(input: ManualNcbaPaymentInput, actorId: string) {
    const result = await this.processPayment(
      {
        TransID: input.transId,
        TransAmount: input.amount,
        BillRefNumber: input.till ?? null,
        Narrative: input.meterNumber,
        Mobile: input.phone,
        name: input.name ?? 'Customer',
      },
      PaymentChannel.NCBA,
      actorId,
    );
    if (result.duplicate) throw new ConflictError(`Transaction ${input.transId} has already been recorded.`);
    return result;
  }

  private async audit(payment: Payment, actorId: string | null) {
    await this.app.auditLog.record({
      actorId,
      action: 'CREATE',
      subjectType: 'PAYMENT',
      subjectId: payment.id,
      summary: `${actorId ? 'Manually recorded ' : ''}${payment.channel} payment KES ${payment.amount} from ${payment.phone} for ${payment.accountReference ?? 'unknown account'}`,
    });
  }
}
