import { AppContext } from '../../context.js';
import { Prisma, type Payment } from '../../generated/prisma/index.js';
import { PaymentChannel, PaymentStatus, TransactionStatus } from '../../shared/types/index.js';
import { BadRequestError } from '../../shared/errors/AppError.js';
import { GatewayCredentialsService } from '../settings/gateway-credentials.service.js';
import { VEND_METER_INCLUDE, VendingService, type VendMeter } from '../tokens/vending.service.js';
import { NcbaPaymentService, type ProcessPaymentResult } from '../ncba/ncba-payment.service.js';
import { DarajaClient, type DarajaCredentials, firstMissingDarajaField } from './daraja.client.js';

/**
 * Safaricom M-Pesa in one place (port of the Laravel MpesaController +
 * MpesaC2bController): STK push and its callback, payment status polling,
 * and C2B paybill confirmations. Each confirmed payment against a known meter
 * number is auto-vended into STS tokens and SMS'd to the payer.
 *
 * Daraja HTTP calls live in DarajaClient (./daraja.client.ts).
 */

const STK_FAILURE_REASONS: Record<number, string> = {
  1: 'Transaction was cancelled by user',
  1032: 'Transaction was cancelled by user',
  2001: 'Wrong M-Pesa PIN was entered',
  2002: 'Insufficient M-Pesa balance',
  2003: 'Transaction timed out. Please try again',
  17: 'A rule has declined this transaction. Check your M-Pesa limits',
  26: 'System is busy. Please try again later',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Give the callback this long before asking Daraja ourselves. */
const STK_QUERY_AFTER_MS = 20_000;
/** At most one STK query per payment this often (status polls and the reconciler share it). */
const STK_QUERY_EVERY_MS = 10_000;
/** STK prompts expire within ~2 min; past this a still-unknown payment is failed. */
const STK_EXPIRE_AFTER_MS = 15 * 60_000;
/** resultCode for payments we stopped waiting on - a late callback may still confirm them. */
const STK_TIMEOUT_CODE = 'TIMEOUT';

/** When each pending payment was last queried (process-wide). */
const lastQueried = new Map<string, number>();

type StkOutcome =
  | { ok: true; amount: number; receipt: string | null; phone: string | null; resultDesc: string | null; merchantRequestId: string | null; accountReference?: string | null }
  | { ok: false; resultCode: number | string; resultDesc: string | null; merchantRequestId: string | null };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export class MpesaPaymentService {
  private credentials: GatewayCredentialsService;
  private vending: VendingService;
  private paybill: NcbaPaymentService;

  constructor(private app: AppContext) {
    this.credentials = new GatewayCredentialsService(app);
    this.vending = new VendingService(app);
    this.paybill = new NcbaPaymentService(app);
  }

  private findMeterByNumber(meterNumber: string | null | undefined): Promise<VendMeter | null> {
    if (!meterNumber) return Promise.resolve(null);
    return this.app.prisma.meter.findUnique({ where: { meterNumber }, include: VEND_METER_INCLUDE });
  }

  // ── STK push (M-Pesa Express) ─────────────────────────────────────────────

  /**
   * Daraja credentials for paying into `meterNumber`: the meter's vendor or
   * landlord config if one exists, otherwise the global M-Pesa config.
   */
  async credentialsForMeter(meterNumber: string | null): Promise<DarajaCredentials> {
    const meter = meterNumber
      ? await this.app.prisma.meter.findUnique({
          where: { meterNumber },
          include: { vendor: { include: { mpesaConfig: true } }, landlord: { include: { mpesaConfig: true } } },
        })
      : null;

    const stored = meter?.vendor?.mpesaConfig ?? (meter?.vendor ? null : meter?.landlord?.mpesaConfig) ?? null;
    if (stored) {
      const creds = await this.credentials.fromStoredConfig(stored);
      const missing = firstMissingDarajaField(creds);
      if (missing) throw new BadRequestError(`M-Pesa configuration is incomplete. Missing: ${missing}`);
      return creds as DarajaCredentials;
    }

    if (meterNumber && !meter) this.app.log.warn({ meterNumber }, 'STK push for unknown meter - using global M-Pesa config');
    const global = await this.credentials.globalCredentials();
    if (!global) {
      throw new BadRequestError(
        'M-Pesa is not configured for this meter. An administrator must add M-Pesa credentials in Payment API settings.',
      );
    }
    return global;
  }

  /** Sends an STK push and records a PENDING payment keyed by CheckoutRequestID. */
  async stkPush(input: { phone: string; amount: number; reference?: string }) {
    const reference = input.reference?.trim() || 'Payment';
    const creds = await this.credentialsForMeter(reference === 'Payment' ? null : reference);
    const response = await this.app.mpesa.stkPush(creds, input.phone, input.amount, reference);

    if (DarajaClient.isError(response) || !response.CheckoutRequestID) {
      this.app.log.error({ response }, 'M-Pesa STK push failed');
      throw new BadRequestError(DarajaClient.errorMessage(response));
    }

    const meter = reference === 'Payment' ? null : await this.app.prisma.meter.findUnique({ where: { meterNumber: reference }, select: { id: true } });
    await this.app.prisma.payment.create({
      data: {
        meterId: meter?.id ?? null,
        channel: PaymentChannel.STK,
        status: PaymentStatus.PENDING,
        checkoutRequestId: response.CheckoutRequestID,
        merchantRequestId: response.MerchantRequestID ?? null,
        accountReference: reference,
        phone: input.phone,
        amount: input.amount,
      },
    });

    return {
      checkoutRequestId: response.CheckoutRequestID as string,
      merchantRequestId: (response.MerchantRequestID as string) ?? null,
      customerMessage: (response.CustomerMessage as string) ?? 'Check your phone to complete the payment.',
    };
  }

  /** Safaricom STK callback. Always resolves - the caller answers Daraja with ResultCode 0. */
  async handleStkCallback(body: any): Promise<void> {
    const cb = body?.Body?.stkCallback ?? {};
    const checkoutRequestId: string | null = cb.CheckoutRequestID ?? null;
    const merchantRequestId: string | null = cb.MerchantRequestID ?? null;
    const resultCode = Number(cb.ResultCode ?? -1);
    const resultDesc: string | null = cb.ResultDesc ?? null;

    this.app.log.info({ checkoutRequestId, resultCode, resultDesc }, 'M-Pesa STK callback received');
    if (!checkoutRequestId) return;

    if (resultCode !== 0) {
      await this.settle(checkoutRequestId, { ok: false, resultCode, resultDesc: resultDesc ?? STK_FAILURE_REASONS[resultCode] ?? null, merchantRequestId });
      return;
    }

    const items: { Name?: string; Value?: unknown }[] = cb.CallbackMetadata?.Item ?? [];
    const meta = Object.fromEntries(items.map((i) => [i.Name, i.Value]));
    const amount = Number(meta.Amount ?? 0);
    const receipt = meta.MpesaReceiptNumber ? String(meta.MpesaReceiptNumber) : null;

    if (!receipt || amount <= 0) {
      this.app.log.warn({ checkoutRequestId, receipt, amount }, 'STK callback successful but missing receipt or amount');
      return;
    }

    await this.settle(checkoutRequestId, {
      ok: true,
      amount,
      receipt,
      phone: meta.PhoneNumber ? String(meta.PhoneNumber) : null,
      resultDesc,
      merchantRequestId,
      accountReference: meta.AccountReference ? String(meta.AccountReference) : null,
    });
  }

  /**
   * Moves an STK payment out of PENDING exactly once - whichever of the
   * callback, a status poll's STK query or the background reconciler gets
   * there first - then vends and SMSes on success. Later arrivals only fill in
   * the receipt number an STK query can't supply.
   */
  private async settle(checkoutRequestId: string, outcome: StkOutcome): Promise<void> {
    const existing = await this.app.prisma.payment.findUnique({ where: { checkoutRequestId } });

    // A callback for a push we have no record of.
    if (!existing) {
      if (!outcome.ok) {
        await this.app.prisma.payment.create({
          data: {
            channel: PaymentChannel.STK, status: PaymentStatus.FAILED, checkoutRequestId, merchantRequestId: outcome.merchantRequestId,
            resultCode: String(outcome.resultCode), resultDesc: outcome.resultDesc, phone: 'UNKNOWN', amount: 0, accountReference: 'UNKNOWN-METER',
          },
        });
        return;
      }
      let payment: Payment;
      try {
        payment = await this.app.prisma.payment.create({
          data: {
            channel: PaymentChannel.STK, status: PaymentStatus.CONFIRMED, checkoutRequestId, merchantRequestId: outcome.merchantRequestId,
            mpesaReceiptNumber: outcome.receipt, amount: outcome.amount, phone: outcome.phone ?? 'UNKNOWN', resultCode: '0',
            resultDesc: outcome.resultDesc, accountReference: outcome.accountReference ?? null,
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          this.app.log.warn({ checkoutRequestId }, 'Duplicate STK callback ignored');
          return;
        }
        throw err;
      }
      await this.afterConfirmed(payment);
      return;
    }

    // A payment we gave up on can still be confirmed by a late callback.
    const timedOut = existing.status === PaymentStatus.FAILED && existing.resultCode === STK_TIMEOUT_CODE;
    if (existing.status !== PaymentStatus.PENDING && !timedOut) {
      if (outcome.ok && outcome.receipt && existing.status === PaymentStatus.CONFIRMED && !existing.mpesaReceiptNumber) {
        await this.app.prisma.payment
          .update({ where: { id: existing.id }, data: { mpesaReceiptNumber: outcome.receipt } })
          .catch((err) => this.app.log.warn({ err, checkoutRequestId }, 'Could not record late M-Pesa receipt'));
      } else {
        this.app.log.info({ checkoutRequestId, status: existing.status }, 'STK payment already settled - ignoring');
      }
      return;
    }

    const data = outcome.ok
      ? {
          status: PaymentStatus.CONFIRMED,
          amount: outcome.amount,
          phone: outcome.phone ?? existing.phone,
          resultCode: '0',
          resultDesc: outcome.resultDesc,
          merchantRequestId: outcome.merchantRequestId ?? existing.merchantRequestId,
          ...(outcome.receipt ? { mpesaReceiptNumber: outcome.receipt } : {}),
        }
      : { status: PaymentStatus.FAILED, resultCode: String(outcome.resultCode), resultDesc: outcome.resultDesc };

    let won: number;
    try {
      // Compare-and-set: only the first path to see this state settles it.
      ({ count: won } = await this.app.prisma.payment.updateMany({
        where: { id: existing.id, status: existing.status, resultCode: existing.resultCode },
        data,
      }));
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.app.log.warn({ checkoutRequestId }, 'Duplicate M-Pesa receipt ignored');
        return;
      }
      throw err;
    }
    lastQueried.delete(existing.id);
    if (!won || !outcome.ok) return;

    const payment = await this.app.prisma.payment.findUniqueOrThrow({ where: { id: existing.id } });
    await this.afterConfirmed(payment);
  }

  /** Audit, then vend + token SMS (or a plain confirmation SMS when the meter is unknown). */
  private async afterConfirmed(payment: Payment): Promise<void> {
    await this.app.auditLog.record({
      actorId: null,
      action: 'CREATE',
      subjectType: 'PAYMENT',
      subjectId: payment.id,
      summary: `${payment.channel} payment KES ${payment.amount} from ${payment.phone} for ${payment.accountReference ?? 'unknown account'}`,
    });
    const meter = await this.findMeterByNumber(payment.accountReference);
    if (meter) {
      await this.vending.vendForPayment(payment, meter, 'M-Pesa');
    } else {
      await this.vending.sendPaymentConfirmation(payment);
    }
  }

  /**
   * Resolves a PENDING STK payment by asking Daraja (STK Push Query) when its
   * callback is late or lost - sandbox callbacks, and callbacks during
   * Safaricom incidents, often never arrive. Throttled per payment; never throws.
   */
  async reconcile(payment: Payment): Promise<void> {
    if (payment.status !== PaymentStatus.PENDING || payment.channel !== PaymentChannel.STK || !payment.checkoutRequestId) return;
    const now = Date.now();
    const age = now - payment.createdAt.getTime();
    if (age < STK_QUERY_AFTER_MS || now - (lastQueried.get(payment.id) ?? 0) < STK_QUERY_EVERY_MS) return;
    lastQueried.set(payment.id, now);
    const checkoutRequestId = payment.checkoutRequestId;

    try {
      const ref = payment.accountReference && payment.accountReference !== 'Payment' ? payment.accountReference : null;
      const creds = await this.credentialsForMeter(ref).catch((err) => {
        this.app.log.warn({ err, checkoutRequestId }, 'STK query skipped: no usable M-Pesa credentials');
        return null;
      });
      const res = creds ? await this.app.mpesa.stkQuery(creds, checkoutRequestId) : null;
      // "The transaction is still under processing" can carry a ResultCode too.
      const settled = !!res && res.ResultCode !== undefined && res.ResultCode !== null && res.ResultCode !== ''
        && !/processing/i.test(String(res.ResultDesc ?? ''));

      if (settled) {
        const code = Number(res.ResultCode);
        this.app.log.info({ checkoutRequestId, resultCode: code, resultDesc: res.ResultDesc }, 'M-Pesa STK query result');
        await this.settle(
          checkoutRequestId,
          code === 0
            ? { ok: true, amount: Number(payment.amount), receipt: null, phone: payment.phone, resultDesc: res.ResultDesc ?? 'Confirmed by STK query', merchantRequestId: res.MerchantRequestID ?? null }
            : { ok: false, resultCode: code, resultDesc: res.ResultDesc ?? STK_FAILURE_REASONS[code] ?? null, merchantRequestId: null },
        );
        return;
      }
      if (res) this.app.log.info({ checkoutRequestId, response: res }, 'M-Pesa STK query: not settled yet');
      if (age > STK_EXPIRE_AFTER_MS) {
        await this.settle(checkoutRequestId, { ok: false, resultCode: STK_TIMEOUT_CODE, resultDesc: 'No confirmation from M-Pesa', merchantRequestId: null });
      }
    } catch (err) {
      this.app.log.error({ err, checkoutRequestId }, 'STK reconcile failed');
    }
  }

  /** Background sweep for STK payments nobody is polling (payer closed the page, callback lost). */
  startReconciler(): () => void {
    const run = async () => {
      const now = Date.now();
      const pending = await this.app.prisma.payment.findMany({
        where: {
          channel: PaymentChannel.STK,
          status: PaymentStatus.PENDING,
          createdAt: { lte: new Date(now - STK_QUERY_AFTER_MS), gte: new Date(now - 24 * 60 * 60_000) },
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
      });
      for (const p of pending) await this.reconcile(p);
    };
    const timer = setInterval(() => run().catch((err) => this.app.log.error({ err }, 'STK reconciler run failed')), 30_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async statusSnapshot(payment: Payment) {
    const data: Record<string, unknown> = {
      status: payment.status,
      amount: payment.amount,
      resultCode: payment.resultCode,
      resultDesc: payment.resultDesc,
      mpesaReceipt: payment.mpesaReceiptNumber,
      accountReference: payment.accountReference,
    };
    if (payment.status === PaymentStatus.FAILED) {
      data.failureReason = STK_FAILURE_REASONS[Number(payment.resultCode)] ?? payment.resultDesc ?? 'Transaction failed. Please try again';
    }
    if (payment.status === PaymentStatus.CONFIRMED) {
      const tx = await this.app.prisma.tokenTransaction.findFirst({
        where: { paymentId: payment.id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, tokens: true, description: true, smsSent: true },
      });
      if (tx?.status === TransactionStatus.SUCCESS) {
        data.tokens = tx.tokens;
        data.smsSent = tx.smsSent;
      }
      if (tx?.status === TransactionStatus.FAILED) data.vendError = tx.description;
    }
    return data;
  }

  /**
   * Payment status; with `wait`, long-polls up to 25s for the outcome (and up
   * to 20s more for the tokens). A late or lost callback is covered by an STK query.
   */
  async checkStatus(checkoutRequestId: string, wait: boolean) {
    const deadline = Date.now() + (wait ? 25_000 : 0);
    for (;;) {
      let payment = await this.app.prisma.payment.findUnique({ where: { checkoutRequestId } });
      if (payment?.status === PaymentStatus.PENDING) {
        await this.reconcile(payment);
        payment = await this.app.prisma.payment.findUnique({ where: { checkoutRequestId } });
      }
      if (payment && payment.status !== PaymentStatus.PENDING) {
        if (payment.status === PaymentStatus.CONFIRMED) {
          // Prism + SMS usually take a few seconds after the payment settles.
          const tokenDeadline = Date.now() + (wait ? 20_000 : 0);
          for (;;) {
            const snap = await this.statusSnapshot(payment);
            if (snap.tokens || snap.vendError || Date.now() >= tokenDeadline) return snap;
            await sleep(500);
          }
        }
        return this.statusSnapshot(payment);
      }
      if (Date.now() >= deadline) {
        return { status: PaymentStatus.PENDING, message: 'Transaction is still processing' };
      }
      await sleep(1_000);
    }
  }

  // ── C2B paybill ───────────────────────────────────────────────────────────

  /**
   * Safaricom C2B confirmation: normalized into the paybill shape and run
   * through the same store → vend → SMS flow as NCBA. Returns null when the
   * notification is missing required fields.
   */
  async handleC2bConfirmation(data: Record<string, unknown>): Promise<ProcessPaymentResult | null> {
    const payload = this.paybill.normalizeC2bPayload(data);
    if (!payload.TransID || !payload.TransAmount || !payload.Mobile) return null;
    if (await this.paybill.isDuplicate(payload.TransID)) return { duplicate: true };
    return this.paybill.processPayment(payload, PaymentChannel.C2B);
  }
}
