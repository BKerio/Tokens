import { AppContext } from '../../context.js';
import type { Prisma } from '../../generated/prisma/index.js';
import { PaymentChannel, PaymentStatus, TransactionStatus } from '../../shared/types/index.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';
import { splitAccountRef } from '../ncba/ncba-payment.service.js';
import { VEND_METER_INCLUDE, VendingService } from '../tokens/vending.service.js';

/**
 * Admin view over every payment channel (M-Pesa STK, C2B, NCBA): the ledger
 * and token recovery. Channel-specific intake lives in modules/mpesa and
 * modules/ncba.
 */
export class PaymentService {
  private vending: VendingService;
  private revending = new Set<string>();

  constructor(private app: AppContext) {
    this.vending = new VendingService(app);
  }

  /**
   * Retry the token for a confirmed payment whose meter wasn't found or whose
   * vend failed - optionally against a corrected meter number. Refuses when a
   * token was already issued, so a payment is never credited twice.
   */
  async revendPayment(paymentId: string, actorId: string, meterNumberOverride?: string) {
    if (this.revending.has(paymentId)) throw new ConflictError('This payment is already being re-vended.');
    this.revending.add(paymentId);
    try {
      let payment = await this.app.prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundError('Payment');
      if (payment.status !== PaymentStatus.CONFIRMED) throw new UnprocessableError('Only confirmed payments can be re-vended.');

      const issued = await this.app.prisma.tokenTransaction.count({ where: { paymentId, status: TransactionStatus.SUCCESS } });
      if (issued > 0) throw new ConflictError('A token has already been issued for this payment.');

      const current = splitAccountRef(payment.accountReference, null);
      const meterNumber = meterNumberOverride?.trim() || current.meterNumber;
      const meter = meterNumber
        ? await this.app.prisma.meter.findUnique({ where: { meterNumber }, include: VEND_METER_INCLUDE })
        : null;
      if (!meter) throw new NotFoundError(`Meter ${meterNumber ?? ''}`.trim());

      if (meterNumberOverride && meterNumber !== current.meterNumber) {
        const accountReference = current.tillNumber ? `${current.tillNumber}#${meterNumber}` : meterNumber;
        payment = await this.app.prisma.payment.update({ where: { id: paymentId }, data: { accountReference } });
      }

      await this.app.auditLog.record({
        actorId,
        action: 'VEND',
        subjectType: 'PAYMENT',
        subjectId: payment.id,
        summary: `Re-vended ${payment.channel} payment ${payment.mpesaReceiptNumber ?? payment.id} (KES ${payment.amount}) to meter ${meter.meterNumber}`,
      });

      const label = payment.channel === PaymentChannel.NCBA ? 'NCBA Paybill' : payment.channel === PaymentChannel.C2B ? 'C2B Paybill' : 'M-Pesa';
      return { paymentId: payment.id, meterNumber: meter.meterNumber, ...(await this.vending.vendForPayment(payment, meter, `${label} (re-vend)`)) };
    } finally {
      this.revending.delete(paymentId);
    }
  }

  async list(filters: {
    status?: PaymentStatus; channel?: PaymentChannel; search?: string; from?: Date; to?: Date; page: number; limit: number;
  }) {
    const where: Prisma.PaymentWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.channel) where.channel = filters.channel;
    if (filters.from || filters.to) {
      where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
    }
    if (filters.search) {
      where.OR = [
        { accountReference: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search } },
        { mpesaReceiptNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.app.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { tokenTransactions: { select: { id: true, status: true, tokens: true }, take: 1, orderBy: { createdAt: 'desc' } } },
        ...paginate(filters.page, filters.limit),
      }),
      this.app.prisma.payment.count({ where }),
    ]);
    return { data, meta: pageMeta(total, filters.page, filters.limit) };
  }
}
