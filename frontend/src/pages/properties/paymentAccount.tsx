import { Building2, Landmark, Smartphone, Store } from 'lucide-react';
import { ChoiceTiles, SheetField, SheetGrid } from '@/components/shared/FormSheet';
import type { UnitPaymentAccount, UnitPaymentMethod } from '@/types/api';

export const PAYMENT_METHODS: { value: UnitPaymentMethod; label: string; hint: string; Icon: typeof Smartphone }[] = [
  { value: 'MPESA_PAYBILL', label: 'M-Pesa Paybill', hint: 'Business no. + account', Icon: Smartphone },
  { value: 'MPESA_TILL', label: 'M-Pesa Till', hint: 'Buy Goods number', Icon: Store },
  { value: 'BANK', label: 'Bank account', hint: 'Deposit or transfer', Icon: Landmark },
];

export interface PaymentDraft {
  method: UnitPaymentMethod;
  number: string;
  account: string;
  bank: string;
  accountName: string;
}

export const emptyDraft = (from?: UnitPaymentAccount | null): PaymentDraft => ({
  method: from?.method ?? 'MPESA_PAYBILL',
  number: from?.number ?? '',
  account: from?.account ?? '',
  bank: from?.bank ?? '',
  accountName: from?.accountName ?? '',
});

/** First problem with a draft, or null when it can be saved. */
export function paymentError(d: PaymentDraft): string | null {
  if (d.method === 'BANK') {
    if (d.bank.trim().length < 2) return 'Enter the bank name.';
    if (d.number.trim().length < 4) return 'Enter the bank account number.';
    return null;
  }
  if (!/^\d{5,8}$/.test(d.number.trim())) return `Enter a valid ${d.method === 'MPESA_TILL' ? 'till' : 'paybill'} number (5-8 digits).`;
  return null;
}

export function toPayment(d: PaymentDraft): UnitPaymentAccount {
  const opt = (v: string) => v.trim() || null;
  return {
    method: d.method,
    number: d.number.trim(),
    account: d.method === 'MPESA_PAYBILL' ? opt(d.account) : null,
    bank: d.method === 'BANK' ? opt(d.bank) : null,
    accountName: opt(d.accountName),
  };
}

/** "Paybill 522522" / "Till 123456" / "KCB Bank" plus a second line with the account details. */
export function paymentSummary(p: UnitPaymentAccount): { title: string; detail: string } {
  if (p.method === 'MPESA_PAYBILL') return { title: `Paybill ${p.number}`, detail: p.account ? `Account ${p.account}` : 'Account: tenant’s lease code' };
  if (p.method === 'MPESA_TILL') return { title: `Till ${p.number}`, detail: p.accountName || 'Buy Goods' };
  return { title: p.bank || 'Bank', detail: `A/C ${p.number}${p.accountName ? ` · ${p.accountName}` : ''}` };
}

export function PaymentChip({ payment }: { payment: UnitPaymentAccount }) {
  const { title, detail } = paymentSummary(payment);
  const Icon = PAYMENT_METHODS.find((m) => m.value === payment.method)?.Icon ?? Building2;
  return (
    <span className="un-pay">
      <span className={`un-pay-ico ${payment.method === 'BANK' ? 'bank' : ''}`}><Icon size={15} /></span>
      <span className="un-pay-text"><b>{title}</b><small>{detail}</small></span>
    </span>
  );
}

export function PaymentAccountFields({ value, onChange, errors }: { value: PaymentDraft; onChange: (next: PaymentDraft) => void; errors?: string | null }) {
  const set = (patch: Partial<PaymentDraft>) => onChange({ ...value, ...patch });
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);
  return (
    <>
      <div className="vf-field">
        <span className="vf-label">How tenants pay <b> *</b></span>
        <ChoiceTiles value={value.method} onChange={(method) => set({ method })} label="Payment method" options={PAYMENT_METHODS} />
      </div>

      {value.method === 'MPESA_PAYBILL' && (
        <SheetGrid>
          <SheetField label="Paybill (business) number" required>
            <input className="input mono" inputMode="numeric" placeholder="e.g. 522522" value={value.number} onChange={(e) => set({ number: digits(e.target.value) })} />
          </SheetField>
          <SheetField label="Account number" aside="Optional" hint="Leave blank and tenants use their lease code">
            <input className="input mono" placeholder="e.g. A1" value={value.account} onChange={(e) => set({ account: e.target.value })} />
          </SheetField>
        </SheetGrid>
      )}
      {value.method === 'MPESA_TILL' && (
        <SheetField label="Till (Buy Goods) number" required>
          <input className="input mono" inputMode="numeric" placeholder="e.g. 123456" value={value.number} onChange={(e) => set({ number: digits(e.target.value) })} />
        </SheetField>
      )}
      {value.method === 'BANK' && (
        <SheetGrid>
          <SheetField label="Bank" required>
            <input className="input" placeholder="e.g. NCBA, KCB, Equity" value={value.bank} onChange={(e) => set({ bank: e.target.value })} />
          </SheetField>
          <SheetField label="Account number" required>
            <input className="input mono" value={value.number} onChange={(e) => set({ number: e.target.value })} />
          </SheetField>
        </SheetGrid>
      )}
      <SheetField label="Account name" aside="Optional" hint="Shown to tenants so they can confirm who they are paying" error={errors ?? undefined}>
        <input className="input" placeholder="e.g. Sunrise Apartments Ltd" value={value.accountName} onChange={(e) => set({ accountName: e.target.value })} />
      </SheetField>

      {paymentError(value) === null && (
        <div className="un-pay-preview">
          <small>Tenants will see</small>
          <PaymentChip payment={toPayment(value)} />
        </div>
      )}
    </>
  );
}
