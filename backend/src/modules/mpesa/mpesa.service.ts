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

    await this.app.prisma.payment.create({
      data: {
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

    const existing = await this.app.prisma.payment.findUnique({ where: { checkoutRequestId } });
    if (existing && existing.status !== PaymentStatus.PENDING) {
      this.app.log.warn({ checkoutRequestId }, 'Duplicate STK callback ignored');
      return;
    }

    if (resultCode !== 0) {
      const failure = { status: PaymentStatus.FAILED, resultCode: String(resultCode), resultDesc: resultDesc ?? STK_FAILURE_REASONS[resultCode] ?? null };
      if (existing) {
        await this.app.prisma.payment.update({ where: { id: existing.id }, data: failure });
      } else {
        await this.app.prisma.payment.create({
          data: { ...failure, channel: PaymentChannel.STK, checkoutRequestId, merchantRequestId, phone: 'UNKNOWN', amount: 0, accountReference: 'UNKNOWN-METER' },
        });
      }
      return;
    }

    const items: { Name?: string; Value?: unknown }[] = cb.CallbackMetadata?.Item ?? [];
    const meta = Object.fromEntries(items.map((i) => [i.Name, i.Value]));
    const amount = Number(meta.Amount ?? 0);
    const receipt = meta.MpesaReceiptNumber ? String(meta.MpesaReceiptNumber) : null;
    const phone = meta.PhoneNumber ? String(meta.PhoneNumber) : existing?.phone ?? 'UNKNOWN';

    if (!receipt || amount <= 0) {
      this.app.log.warn({ checkoutRequestId, receipt, amount }, 'STK callback successful but missing receipt or amount');
      return;
    }

    let payment: Payment;
    try {
      const confirmed = {
        status: PaymentStatus.CONFIRMED,
        mpesaReceiptNumber: receipt,
        amount,
        phone,
        resultCode: '0',
        resultDesc,
        merchantRequestId: merchantRequestId ?? existing?.merchantRequestId ?? null,
      };
      payment = existing
        ? await this.app.prisma.payment.update({ where: { id: existing.id }, data: confirmed })
        : await this.app.prisma.payment.create({
            data: { ...confirmed, channel: PaymentChannel.STK, checkoutRequestId, accountReference: meta.AccountReference ? String(meta.AccountReference) : null },
          });
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.app.log.warn({ receipt }, 'Duplicate M-Pesa receipt ignored');
        return;
      }
      throw err;
    }

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
        select: { status: true, tokens: true, description: true },
      });
      if (tx?.status === TransactionStatus.SUCCESS) data.tokens = tx.tokens;
      if (tx?.status === TransactionStatus.FAILED) data.vendError = tx.description;
    }
    return data;
  }

  /** Payment status; with `wait`, long-polls up to 25s for the callback (and 5s more for tokens). */
  async checkStatus(checkoutRequestId: string, wait: boolean) {
    const deadline = Date.now() + (wait ? 25_000 : 0);
    for (;;) {
      const payment = await this.app.prisma.payment.findUnique({ where: { checkoutRequestId } });
      if (payment && payment.status !== PaymentStatus.PENDING) {
        if (payment.status === PaymentStatus.CONFIRMED) {
          const tokenDeadline = Date.now() + 5_000;
          for (;;) {
            const snap = await this.statusSnapshot(payment);
            if (snap.tokens || snap.vendError || Date.now() >= tokenDeadline) return snap;
            await sleep(250);
          }
        }
        return this.statusSnapshot(payment);
      }
      if (Date.now() >= deadline) {
        return { status: PaymentStatus.PENDING, message: 'Transaction is still processing' };
      }
      await sleep(500);
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
