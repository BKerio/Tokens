import { AppContext } from '../../context.js';
import type { Meter, Payment, Prisma } from '../../generated/prisma/index.js';
import { TokenOwnerType, TokenType, TransactionStatus, VendMode } from '../../shared/types/index.js';
import { UnprocessableError, UpstreamError } from '../../shared/errors/AppError.js';
import { normalizeMsisdn } from '../../shared/utils/phone.js';
import { MeterConfigIn, PrismApiError, tokenStrings } from '../../integrations/prism/prism.client.js';
import { GatewayCredentialsService } from '../settings/gateway-credentials.service.js';

/** STS defaults used when neither VendingSetting nor the meter specifies a value. */
const STS_DEFAULTS = { sgc: 600909, krn: 1, ti: 1, ea: 7, tct: 1, ken: 255 };

/** A meter loaded with what vending needs: owners (for SMS/rooms) and its first customer. */
export const VEND_METER_INCLUDE = {
  vendor: { select: { id: true, userId: true, businessName: true } },
  landlord: { select: { id: true, userId: true, fullName: true } },
  customers: { select: { id: true, name: true, phone: true }, orderBy: { createdAt: 'asc' }, take: 1 },
} satisfies Prisma.MeterInclude;

export type VendMeter = Prisma.MeterGetPayload<{ include: typeof VEND_METER_INCLUDE }>;

export interface ManualVendInput {
  tokenType: TokenType;
  vendMode?: VendMode;
  amount?: number;
  externalTransactionId?: string;
  transactionTime?: Date;
  sendSms?: boolean;
  phone?: string;
  controlValue?: number;
}

export interface PaymentVendResult {
  tokenGenerated: boolean;
  tokens: string[];
  smsSent: boolean;
  error?: string;
}

/** "1234-5678-9012-3456-7890" */
export function formatToken(token: string): string {
  return token.match(/.{1,4}/g)?.join('-') ?? token;
}

const KES = (n: number) => n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "20261016 14:05" in Nairobi time - the legacy SMS date format. */
function smsDate(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')} ${get('hour')}:${get('minute')}`;
}

function ownerOf(meter: Pick<Meter, 'vendorId' | 'landlordId'>): TokenOwnerType {
  if (meter.vendorId) return TokenOwnerType.VENDOR;
  if (meter.landlordId) return TokenOwnerType.LANDLORD;
  return TokenOwnerType.UNASSIGNED;
}

function describe(tokenType: TokenType, amount: number | null, controlValue: number | null, count: number): string {
  switch (tokenType) {
    case TokenType.CREDIT: return `Successfully generated ${count} credit token(s) for KES ${KES(amount ?? 0)}`;
    case TokenType.CLEAR_TAMPER: return `Successfully generated ${count} clear tamper token(s).`;
    case TokenType.CLEAR_CREDIT: return `Successfully generated ${count} clear credit token(s).`;
    case TokenType.SET_MAX_OVERDRAFT: return `Successfully generated ${count} max overdraft token(s) with value ${controlValue}.`;
    default: return `Successfully generated ${count} token(s).`;
  }
}

/**
 * Issues STS tokens through Prism and records every attempt as a
 * TokenTransaction - for manual vends from the portal and for automatic
 * vends triggered by M-Pesa / paybill payments.
 */
export class VendingService {
  private credentials: GatewayCredentialsService;

  constructor(private app: AppContext) {
    this.credentials = new GatewayCredentialsService(app);
  }

  /**
   * STS key data: the meter's own values win, then the global Vending Control
   * defaults (Settings), then built-in defaults. TCT has no per-meter field.
   */
  async meterConfig(meter: Pick<Meter, 'meterNumber' | 'sgc' | 'krn' | 'ti' | 'ea' | 'ken'>): Promise<MeterConfigIn> {
    const d = await this.app.settings.vendingDefaults();
    return {
      drn: meter.meterNumber,
      sgc: meter.sgc ?? d.vending_sgc ?? STS_DEFAULTS.sgc,
      krn: meter.krn ?? d.vending_krn ?? STS_DEFAULTS.krn,
      ti: meter.ti ?? d.vending_ti ?? STS_DEFAULTS.ti,
      ea: meter.ea ?? d.vending_ea ?? STS_DEFAULTS.ea,
      tct: d.vending_tct ?? STS_DEFAULTS.tct,
      ken: meter.ken ?? d.vending_ken ?? STS_DEFAULTS.ken,
      allowKrnUpdate: false,
    };
  }

  /** Runs one Prism vend on a fresh connection, always closing it. */
  private async withPrism<T>(fn: (client: ReturnType<AppContext['createPrismClient']>) => Promise<T>): Promise<{ result: T; messageId: string | null }> {
    const client = this.app.createPrismClient();
    try {
      const result = await fn(client);
      return { result, messageId: client.lastMessageId };
    } finally {
      client.close();
    }
  }

  private controlConfig(tokenType: Exclude<TokenType, 'CREDIT'>, controlValue?: number) {
    const cfg = this.app.config.TOKEN_CONTROLS[tokenType];
    if (cfg.index === null) {
      throw new UnprocessableError(`Control token mapping for ${tokenType} is not configured on the server.`);
    }
    const value = tokenType === TokenType.SET_MAX_OVERDRAFT ? (controlValue ?? cfg.value) : cfg.value;
    if (value === null || value === undefined) {
      throw new UnprocessableError(`Control value for ${tokenType} is required.`);
    }
    return { index: cfg.index, value, isFlag: cfg.isFlag };
  }

  /** Tells admins and the meter's owner that a transaction was recorded. */
  private broadcast(meter: VendMeter | null, payload: Record<string, unknown>) {
    const rooms = ['role:ADMIN', 'role:SUPER_ADMIN'];
    if (meter?.vendor?.userId) rooms.push(`user:${meter.vendor.userId}`);
    if (meter?.landlord?.userId) rooms.push(`user:${meter.landlord.userId}`);
    this.app.io.to(rooms).emit('transaction:created', payload);
  }

  /** Manual vend from the portal (credit or control token). */
  async manualVend(meter: VendMeter, actorUserId: string, input: ManualVendInput) {
    const customer = meter.customers[0] ?? null;
    const phone = input.phone || customer?.phone || null;
    const sendSms = !!input.sendSms;
    const vendMode = input.vendMode ?? VendMode.VALUE;

    let amount: number | null = null;
    let units: number | null = null;
    let control: { index: number; value: number; isFlag: boolean } | null = null;

    if (input.tokenType === TokenType.CREDIT) {
      if (input.amount === undefined) throw new UnprocessableError('Amount is required for credit vending.');
      const price = Number(meter.pricePerUnit);
      if (vendMode === VendMode.UNIT) {
        if (price <= 0) throw new UnprocessableError('This meter has no valid price per unit set for vend-by-unit.');
        units = input.amount;
        amount = Math.round(units * price * 100) / 100;
      } else {
        amount = input.amount;
        units = price > 0 ? Math.round((amount / price) * 1000) / 1000 : null;
      }
    } else {
      control = this.controlConfig(input.tokenType, input.controlValue);
    }

    const base = {
      meterId: meter.id,
      meterNumberSnapshot: meter.meterNumber,
      vendorId: meter.vendorId,
      landlordId: meter.landlordId,
      ownerType: ownerOf(meter),
      actorUserId,
      customerId: customer?.id ?? null,
      amount,
      units,
      tokenType: input.tokenType,
      vendMode: input.tokenType === TokenType.CREDIT ? vendMode : null,
      controlIndex: control?.index ?? null,
      controlValue: control?.value ?? null,
      externalTransactionId: input.externalTransactionId ?? null,
      transactionTime: input.transactionTime ?? null,
      sendSms,
      phone,
    };

    const config = await this.meterConfig(meter);
    let vend: { result: string[]; messageId: string | null };
    try {
      vend = await this.withPrism(async (client) =>
        tokenStrings(
          control
            ? await client.issueSetControlToken(config, control.isFlag, control.index, control.value)
            : await client.issueCreditToken(config, amount!),
        ),
      );
    } catch (err) {
      const isApi = err instanceof PrismApiError;
      const message = err instanceof Error ? err.message : String(err);
      this.app.log.error({ err, meter: meter.meterNumber }, 'Prism vend failed');
      await this.app.prisma.tokenTransaction.create({
        data: {
          ...base,
          status: TransactionStatus.FAILED,
          description: isApi ? `Prism Error: ${err.eCode} - ${err.eMsgEn}` : `System Error: ${message}`,
        },
      });
      if (isApi) {
        throw new UpstreamError('Failed to generate token from Prism network', { errorCode: err.eCode, errorDetails: err.eMsgEn });
      }
      throw new UpstreamError('Could not reach the token server', { error: message });
    }

    const tokens = vend.result;
    let smsSent = false;
    if (sendSms && phone && tokens.length) {
      smsSent = await this.app.sms.send(
        phone,
        this.manualTokenMessage(meter.meterNumber, tokens, input.tokenType, amount, units, control?.value ?? null, input.externalTransactionId),
        await this.credentials.vendorSmsConfig(meter.vendorId),
      );
    }

    const transaction = await this.app.prisma.tokenTransaction.create({
      data: {
        ...base,
        tokens,
        smsSent,
        prismMessageId: vend.messageId,
        status: TransactionStatus.SUCCESS,
        description: describe(input.tokenType, amount, control?.value ?? null, tokens.length),
      },
    });

    this.broadcast(meter, { id: transaction.id, meterNumber: meter.meterNumber, tokenType: input.tokenType, amount, status: 'SUCCESS' });
    return { transaction, tokens, smsSent };
  }

  /**
   * Automatic credit vend for a confirmed payment, then the token SMS (or a
   * plain payment confirmation if vending fails). Never throws.
   */
  async vendForPayment(payment: Payment, meter: VendMeter, channelLabel: string): Promise<PaymentVendResult> {
    const amount = Number(payment.amount);
    const customer = meter.customers[0] ?? null;
    const vendorSms = await this.credentials.vendorSmsConfig(meter.vendorId);
    const base = {
      meterId: meter.id,
      meterNumberSnapshot: meter.meterNumber,
      vendorId: meter.vendorId,
      landlordId: meter.landlordId,
      ownerType: ownerOf(meter),
      customerId: customer?.id ?? null,
      paymentId: payment.id,
      amount,
      tokenType: TokenType.CREDIT,
      vendMode: VendMode.VALUE,
      phone: payment.phone,
    };

    try {
      const config = await this.meterConfig(meter);
      const vend = await this.withPrism(async (client) => tokenStrings(await client.issueCreditToken(config, amount)));
      const tokens = vend.result;
      const price = Number(meter.pricePerUnit);

      const smsSent = await this.sendToPayer(payment.phone, this.paymentTokenMessage(meter.meterNumber, tokens, amount, price), vendorSms);

      const transaction = await this.app.prisma.tokenTransaction.create({
        data: {
          ...base,
          units: price > 0 ? Math.round((amount / price) * 1000) / 1000 : null,
          tokens,
          sendSms: true,
          smsSent,
          prismMessageId: vend.messageId,
          status: TransactionStatus.SUCCESS,
          description: `${channelLabel} payment generated ${tokens.length} token(s).`,
        },
      });
      this.broadcast(meter, { id: transaction.id, meterNumber: meter.meterNumber, tokenType: 'CREDIT', amount, status: 'SUCCESS' });
      return { tokenGenerated: true, tokens, smsSent };
    } catch (err) {
      const message = err instanceof PrismApiError ? `${err.eCode} - ${err.eMsgEn}` : err instanceof Error ? err.message : String(err);
      this.app.log.error({ err, paymentId: payment.id, meter: meter.meterNumber }, `${channelLabel}: token generation failed`);
      await this.app.prisma.tokenTransaction.create({
        data: { ...base, status: TransactionStatus.FAILED, description: `${channelLabel} Prism/System Error: ${message}` },
      });
      this.broadcast(meter, { meterNumber: meter.meterNumber, tokenType: 'CREDIT', amount, status: 'FAILED' });
      const smsSent = await this.sendPaymentConfirmation(payment, meter.vendorId);
      return { tokenGenerated: false, tokens: [], smsSent, error: message };
    }
  }

  /** Plain "we received your payment" SMS (no tokens). */
  async sendPaymentConfirmation(payment: Payment, vendorId?: string | null): Promise<boolean> {
    const lines = [
      'PAYMENT CONFIRMATION',
      '',
      'We have received your M-Pesa payment.',
      '',
      `AMOUNT: KES ${KES(Number(payment.amount))}`,
      `REFERENCE: ${payment.accountReference || 'Payment'}`,
      ...(payment.mpesaReceiptNumber ? [`M-PESA RECEIPT: ${payment.mpesaReceiptNumber}`] : []),
      `DATE: ${smsDate(payment.createdAt)}`,
      '',
      'Thank you for your payment.',
    ];
    return this.sendToPayer(payment.phone, lines.join('\n'), await this.credentials.vendorSmsConfig(vendorId));
  }

  private async sendToPayer(phone: string, message: string, vendorSms: Awaited<ReturnType<GatewayCredentialsService['vendorSmsConfig']>>) {
    const msisdn = normalizeMsisdn(phone);
    if (!msisdn) {
      this.app.log.warn({ phone }, 'Cannot send SMS: invalid phone number');
      return false;
    }
    return this.app.sms.send(msisdn, message, vendorSms);
  }

  private paymentTokenMessage(meterNumber: string, tokens: string[], amount: number, pricePerUnit: number): string {
    const price = pricePerUnit > 0 ? pricePerUnit : 1;
    const units = Math.round((amount / price) * 10) / 10;
    const tokenAmount = units * price;
    return [
      'Token purchase Successful',
      '',
      `Mtr: ${meterNumber}`,
      ...tokens.map((t) => `Token: ${formatToken(t)}`),
      `Date: ${smsDate()}`,
      `Units: ${units.toFixed(1)}`,
      `Amt: ${KES(amount)}`,
      `TknAmt: ${KES(tokenAmount)}`,
      `OtherCharges: ${KES(amount - tokenAmount)}`,
      '',
      'For details dial *367*878#',
      'Best Regards,',
      'TokenPAP System',
    ].join('\n');
  }

  private manualTokenMessage(
    meterNumber: string, tokens: string[], tokenType: TokenType,
    amount: number | null, units: number | null, controlValue: number | null, txnId?: string,
  ): string {
    const lines = [
      tokenType === TokenType.CREDIT ? 'Token generated successfully' : 'Control token generated successfully',
      '',
      `Mtr: ${meterNumber}`,
      ...tokens.map((t) => `Token: ${formatToken(t)}`),
      `Date: ${smsDate()}`,
    ];
    if (txnId) lines.push(`TxnID: ${txnId}`);
    if (tokenType === TokenType.CREDIT) {
      if (units !== null) lines.push(`Units: ${units.toFixed(1)}`);
      if (amount !== null) lines.push(`Amt: ${KES(amount)}`);
    } else if (tokenType === TokenType.SET_MAX_OVERDRAFT && controlValue !== null) {
      lines.push(`Overdraft: ${controlValue}`);
    } else {
      lines.push(`Type: ${tokenType.replace(/_/g, ' ')}`);
    }
    lines.push('', 'Best Regards,', 'TokenPAP System');
    return lines.join('\n');
  }
}
