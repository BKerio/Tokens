import { fmtKes, toNum } from '@/lib/format';
import type { Aging, BillingFrequency, LedgerEntryType, Money, PaymentMethod, StaffRole } from '@/types/api';

// ── Labels ───────────────────────────────────────────────────────────────────
export const TYPE_LABEL: Record<LedgerEntryType, string> = {
  RENT_CHARGE: 'Rent', OTHER_CHARGE: 'Charge', PAYMENT: 'Payment', CREDIT: 'Credit',
  DEPOSIT_RECEIVED: 'Deposit in', DEPOSIT_REFUND: 'Deposit refund', DEPOSIT_APPLIED: 'Deposit applied', EXPENSE: 'Expense',
};
export const TYPE_PILL: Record<LedgerEntryType, string> = {
  RENT_CHARGE: 'pill pill-blue', OTHER_CHARGE: 'pill pill-blue', PAYMENT: 'pill pill-green', CREDIT: 'pill pill-green',
  DEPOSIT_RECEIVED: 'pill pill-gold', DEPOSIT_REFUND: 'pill pill-gold', DEPOSIT_APPLIED: 'pill pill-gold', EXPENSE: 'pill pill-red',
};
export const FREQ_LABEL: Record<BillingFrequency, string> = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', SEMI_ANNUAL: 'Every 6 months', ANNUAL: 'Yearly' };
export const FREQ_SHORT: Record<BillingFrequency, string> = { MONTHLY: '/mo', QUARTERLY: '/qtr', SEMI_ANNUAL: '/6 mo', ANNUAL: '/yr' };
export const METHOD_LABEL: Record<PaymentMethod, string> = { MPESA: 'M-Pesa', CASH: 'Cash', BANK: 'Bank', CHEQUE: 'Cheque', OTHER: 'Other' };
export const STAFF_ROLE_INFO: Record<StaffRole, { title: string; blurb: string }> = {
  MANAGER: { title: 'Manager', blurb: 'Runs assigned properties: units, tenants, leases, money and reports.' },
  CARETAKER: { title: 'Caretaker', blurb: 'On site: manages tenants, views leases, records payments.' },
  ACCOUNTANT: { title: 'Accountant', blurb: 'Money: charges, payments, deposits, expenses, reversals and reports.' },
  VIEWER: { title: 'Viewer', blurb: 'Read-only access to properties, leases, the ledger and reports.' },
};
export const EXPENSE_CATEGORIES = ['Repairs', 'Maintenance', 'Utilities', 'Security', 'Cleaning', 'Insurance', 'Rates & taxes', 'Management fees', 'Other'];
export const CHARGE_CATEGORIES = ['Water', 'Service charge', 'Garbage', 'Parking', 'Late payment penalty', 'Repairs', 'Other'];

// ── Formatting ───────────────────────────────────────────────────────────────
/** DATE columns arrive as "2026-10-21T00:00:00.000Z" - show the calendar day, not a timezone-shifted one. */
export function fmtDay(value?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!value) return '-';
  return new Date(value.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

/** Signed effect of an entry on what the tenant owes (+ owes more, − owes less); deposits/expenses are neutral. */
export function entrySign(type: LedgerEntryType): 1 | -1 | 0 {
  if (type === 'RENT_CHARGE' || type === 'OTHER_CHARGE') return 1;
  if (type === 'PAYMENT' || type === 'CREDIT' || type === 'DEPOSIT_APPLIED') return -1;
  return 0;
}

export function Amount({ value, type }: { value: Money; type: LedgerEntryType }) {
  const n = toNum(value);
  const inflow = type === 'PAYMENT' || type === 'DEPOSIT_RECEIVED';
  const outflow = type === 'EXPENSE' || type === 'DEPOSIT_REFUND';
  const color = n < 0 ? 'var(--muted)' : inflow ? '#157347' : outflow ? 'var(--red)' : 'var(--ink)';
  return <span className="mono strong" style={{ color, whiteSpace: 'nowrap' }}>{n < 0 ? '−' : ''}{fmtKes(Math.abs(n))}</span>;
}

/** Stacked arrears aging bar + legend. */
export function AgingBar({ aging, compact }: { aging: Aging; compact?: boolean }) {
  const parts: [keyof Aging, string, string][] = [
    ['d1_30', '1-30 days', '#F2B544'],
    ['d31_60', '31-60', '#E8873A'],
    ['d61_90', '61-90', '#D9534F'],
    ['d90plus', '90+', '#9B1C1C'],
  ];
  const total = parts.reduce((n, [k]) => n + aging[k], 0);
  if (total <= 0) return <span className="text-xs" style={{ color: 'var(--muted)' }}>No arrears</span>;
  return (
    <div className="rn-aging">
      <div className="rn-aging-bar">{parts.map(([k, , c]) => aging[k] > 0 && <i key={k} style={{ flexGrow: aging[k], background: c }} title={`${k}: ${fmtKes(aging[k])}`} />)}</div>
      {!compact && (
        <ul>{parts.map(([k, label, c]) => <li key={k}><i style={{ background: c }} />{label}<b>{fmtKes(aging[k])}</b></li>)}</ul>
      )}
    </div>
  );
}
