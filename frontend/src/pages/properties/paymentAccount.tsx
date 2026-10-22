import { AlertTriangle, Building2, Check, Globe2, Landmark, Smartphone, Store, UserRound } from 'lucide-react';
import { SheetField } from '@/components/shared/FormSheet';
import type { PaymentSource, UnitPaymentAccount, UnitPaymentInput, UnitPaymentMethod } from '@/types/api';

export const PAYMENT_METHODS: { value: UnitPaymentMethod; label: string; Icon: typeof Smartphone }[] = [
  { value: 'MPESA_PAYBILL', label: 'M-Pesa Paybill', Icon: Smartphone },
  { value: 'MPESA_TILL', label: 'M-Pesa Till', Icon: Store },
  { value: 'BANK', label: 'Bank account', Icon: Landmark },
];

/** Which configured account a unit uses, plus the paybill account reference. */
export interface PaymentDraft {
  source: string;
  account: string;
  accountName: string;
}

export const emptyDraft = (from?: UnitPaymentAccount | null): PaymentDraft => ({
  source: from?.source ?? '',
  account: from?.account ?? '',
  accountName: from?.accountName ?? '',
});

/** First problem with a draft, or null when it can be saved. */
export function paymentError(d: PaymentDraft, sources: PaymentSource[]): string | null {
  if (!d.source) return sources.length ? 'Choose the account tenants pay into.' : 'No payment accounts are configured yet.';
  if (!sources.some((s) => s.key === d.source)) return 'That account is no longer configured. Choose another.';
  return null;
}

export function toPayment(d: PaymentDraft): UnitPaymentInput {
  return { source: d.source, account: d.account.trim() || null, accountName: d.accountName.trim() || null };
}

/** How the unit will look to tenants once saved. */
export function previewPayment(d: PaymentDraft, sources: PaymentSource[]): UnitPaymentAccount | null {
  const s = sources.find((x) => x.key === d.source);
  if (!s) return null;
  return {
    method: s.method, number: s.number, account: s.method === 'MPESA_PAYBILL' ? d.account.trim() || null : null,
    bank: null, accountName: d.accountName.trim() || null, source: s.key, sourceLabel: s.label, scope: s.scope, stale: false,
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
    <span className={`un-pay${payment.stale ? ' stale' : ''}`} title={payment.stale ? 'This account is no longer configured - choose another' : payment.sourceLabel ?? undefined}>
      <span className={`un-pay-ico ${payment.method === 'BANK' ? 'bank' : ''}${payment.scope === 'GLOBAL' ? ' global' : ''}`}>
        {payment.stale ? <AlertTriangle size={15} /> : <Icon size={15} />}
      </span>
      <span className="un-pay-text">
        <b>{title}</b>
        <small>{payment.stale ? 'No longer configured' : `${payment.scope === 'GLOBAL' ? 'TokenPap · ' : payment.scope === 'LANDLORD' ? 'Yours · ' : ''}${detail}`}</small>
      </span>
    </span>
  );
}

/**
 * Pick the account tenants pay into from those configured in the system:
 * the landlord's own M-Pesa (set by an admin) or TokenPap's global accounts.
 */
export function PaymentAccountFields({ value, onChange, sources, errors }: {
  value: PaymentDraft; onChange: (next: PaymentDraft) => void; sources: PaymentSource[]; errors?: string | null;
}) {
  const set = (patch: Partial<PaymentDraft>) => onChange({ ...value, ...patch });
  const chosen = sources.find((s) => s.key === value.source);
  const preview = previewPayment(value, sources);
  const groups: { scope: PaymentSource['scope']; title: string; hint: string; Icon: typeof Globe2 }[] = [
    { scope: 'LANDLORD', title: 'Your accounts', hint: 'Money goes straight to you', Icon: UserRound },
    { scope: 'GLOBAL', title: 'TokenPap accounts', hint: 'Collected by TokenPap on your behalf', Icon: Globe2 },
  ];

  if (sources.length === 0) {
    return (
      <div className="ps-empty">
        <AlertTriangle size={18} />
        <span><b>No payment accounts are configured yet</b><small>Ask a TokenPap admin to add your M-Pesa paybill or till under Settings → Partner APIs, or to set the system M-Pesa account.</small></span>
      </div>
    );
  }

  return (
    <>
      {groups.map((g) => {
        const list = sources.filter((s) => s.scope === g.scope);
        return (
          <div key={g.scope} className="vf-field">
            <span className="vf-label-row"><span className="vf-label"><g.Icon size={13} style={{ verticalAlign: -2 }} /> {g.title}</span><small>{g.hint}</small></span>
            {list.length === 0 ? (
              <span className="ps-none">{g.scope === 'LANDLORD' ? 'None set up for you yet. A TokenPap admin can add your M-Pesa paybill or till under Settings.' : 'None configured.'}</span>
            ) : (
              <div className="ps-grid" role="radiogroup" aria-label={g.title}>
                {list.map((s) => {
                  const Icon = PAYMENT_METHODS.find((m) => m.value === s.method)?.Icon ?? Smartphone;
                  const on = value.source === s.key;
                  return (
                    <button key={s.key} type="button" role="radio" aria-checked={on} className={`ps-card ${s.scope}${on ? ' on' : ''}`} onClick={() => set({ source: s.key })}>
                      <span className="ps-ico"><Icon size={18} /></span>
                      <span className="ps-text"><b>{s.label}</b><small className="mono">{s.method === 'MPESA_TILL' ? 'Till' : 'Paybill'} {s.number}</small></span>
                      <span className="ps-check">{on && <Check size={14} strokeWidth={3} />}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {errors && <span className="field-error">{errors}</span>}

      {chosen?.method === 'MPESA_PAYBILL' && (
        <SheetField label="Account number" aside="Optional" hint="Leave blank and each tenant uses their lease code - recommended, so payments can be matched to them">
          <input className="input mono" placeholder="Their lease code" value={value.account} onChange={(e) => set({ account: e.target.value })} />
        </SheetField>
      )}
      {chosen && (
        <SheetField label="Account name" aside="Optional" hint="Shown to tenants so they can confirm who they are paying">
          <input className="input" placeholder={chosen.scope === 'GLOBAL' ? 'e.g. TokenPap Ltd' : 'e.g. Sunrise Apartments Ltd'} value={value.accountName} onChange={(e) => set({ accountName: e.target.value })} />
        </SheetField>
      )}

      {preview && (
        <div className="un-pay-preview">
          <small>Tenants will see</small>
          <PaymentChip payment={preview} />
        </div>
      )}
    </>
  );
}
