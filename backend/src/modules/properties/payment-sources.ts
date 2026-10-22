import { AppContext } from '../../context.js';
import { MpesaTransactionType, UnitPaymentMethod } from '../../shared/types/index.js';
import { parseTransactionType } from '../mpesa/daraja.client.js';
import { isPlaceholder } from '../settings/system-config.service.js';

/** A payment account configured in the system that a unit can point its tenants at. */
export interface PaymentSource {
  /** Stable key stored on the unit, e.g. "landlord:paybill" or "global:ncba". */
  key: string;
  scope: 'LANDLORD' | 'GLOBAL';
  label: string;
  method: UnitPaymentMethod;
  number: string;
  /** Where it's configured, for the UI. */
  origin: string;
}

const clean = (v: unknown) => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  return s && !isPlaceholder(s) ? s : null;
};

/** M-Pesa paybill / till accounts from one Daraja config (shortcode is the paybill only on PayBill configs). */
function fromMpesa(
  scope: 'LANDLORD' | 'GLOBAL',
  cfg: { shortcode: string | null; tillNo: string | null; transactionType: MpesaTransactionType },
  who: string,
  origin: string,
): PaymentSource[] {
  const out: PaymentSource[] = [];
  const prefix = scope === 'LANDLORD' ? 'landlord' : 'global';
  if (cfg.transactionType === MpesaTransactionType.CUSTOMER_PAYBILL_ONLINE && cfg.shortcode) {
    out.push({ key: `${prefix}:paybill`, scope, label: `${who} M-Pesa paybill`, method: UnitPaymentMethod.MPESA_PAYBILL, number: cfg.shortcode, origin });
  }
  const till = cfg.tillNo ?? (cfg.transactionType === MpesaTransactionType.CUSTOMER_BUYGOODS_ONLINE ? cfg.shortcode : null);
  if (till) {
    out.push({ key: `${prefix}:till`, scope, label: `${who} M-Pesa till`, method: UnitPaymentMethod.MPESA_TILL, number: till, origin });
  }
  return out;
}

/**
 * The payment accounts a landlord's units may use: the landlord's own M-Pesa
 * configuration (set by an admin under Settings), then TokenPap's global
 * M-Pesa account and NCBA paybill.
 */
export async function paymentSources(app: AppContext, landlordId: string): Promise<PaymentSource[]> {
  const [own, global] = await Promise.all([
    app.prisma.mpesaConfig.findUnique({ where: { landlordId }, select: { shortcode: true, tillNo: true, transactionType: true } }),
    app.settings.getMany(['mpesa_shortcode', 'mpesa_till_no', 'mpesa_transaction_type']),
  ]);

  const sources: PaymentSource[] = [];
  if (own) {
    sources.push(...fromMpesa('LANDLORD', { shortcode: clean(own.shortcode), tillNo: clean(own.tillNo), transactionType: own.transactionType }, 'Your', 'Your M-Pesa account'));
  }
  sources.push(...fromMpesa(
    'GLOBAL',
    { shortcode: clean(global.mpesa_shortcode), tillNo: clean(global.mpesa_till_no), transactionType: parseTransactionType(global.mpesa_transaction_type) },
    'TokenPap',
    'TokenPap system M-Pesa',
  ));
  const ncba = clean(app.config.NCBA_PAYBILL_SHORTCODE);
  if (ncba) sources.push({ key: 'global:ncba', scope: 'GLOBAL', label: 'TokenPap NCBA paybill', method: UnitPaymentMethod.MPESA_PAYBILL, number: ncba, origin: 'TokenPap NCBA' });
  return sources;
}
