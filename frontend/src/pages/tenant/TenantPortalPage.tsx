import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Check, Copy, DoorOpen, Gauge, Phone, Smartphone, Store, Landmark, Wallet } from 'lucide-react';
import api from '@/api/client';
import { fmtKes } from '@/lib/format';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/shared/ui';
import type { BillingFrequency, LeaseAccount, LedgerEntryType, PaymentMethod, UnitPaymentMethod } from '@/types/api';
import { FREQ_LABEL, METHOD_LABEL, TYPE_LABEL, entrySign, fmtDay } from '@/pages/rentals/rentUi';

interface TenantLease {
  id: string;
  code: string;
  status: 'ACTIVE' | 'ENDED' | 'TERMINATED';
  rentAmount: number;
  depositAmount: number;
  billingFrequency: BillingFrequency;
  dueDay: number;
  startDate: string;
  endDate: string | null;
  unit: { id: string; name: string; unitNumber: string | null };
  property: { id: string; name: string };
  account: LeaseAccount;
  nextCharge: { periodStart: string; periodEnd: string; dueDate: string; amount: number } | null;
  meter: { meterNumber: string; type: string } | null;
  payTo: { method: UnitPaymentMethod; number: string | null; account: string | null; accountName: string | null } | null;
  statement: { id: string; type: LedgerEntryType; amount: number; entryDate: string; description: string | null; reference: string | null; method: PaymentMethod | null; balance: number; reversed: boolean; isReversal: boolean }[] | null;
}

interface TenantOverview {
  tenant: { id: string; name: string; phone: string; email: string | null };
  landlord: { name: string; phone: string };
  leases: TenantLease[];
}

const getOverview = async (): Promise<TenantOverview> => (await api.get('/tenant/overview')).data.data;

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="tp-copy"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
      }}
      aria-label={`Copy ${label}`}
    >
      <span className="mono">{value}</span>
      {copied ? <Check size={14} /> : <Copy size={14} strokeWidth={1.75} />}
    </button>
  );
}

function HowToPay({ lease, landlord }: { lease: TenantLease; landlord: TenantOverview['landlord'] }) {
  const p = lease.payTo;
  if (!p || !p.number) {
    return (
      <div className="tp-pay empty">
        <Wallet size={18} strokeWidth={1.75} />
        <span><b>Your landlord hasn’t set up a payment account yet</b><small>Ask {landlord.name} where to send rent{landlord.phone ? ` - ${landlord.phone}` : ''}.</small></span>
      </div>
    );
  }
  const Icon = p.method === 'MPESA_TILL' ? Store : p.method === 'BANK' ? Landmark : Smartphone;
  return (
    <div className="tp-pay">
      <span className="tp-pay-ico"><Icon size={18} strokeWidth={1.75} /></span>
      <div className="tp-pay-body">
        <b>{p.method === 'MPESA_PAYBILL' ? 'M-Pesa Paybill' : p.method === 'MPESA_TILL' ? 'M-Pesa Buy Goods' : 'Bank transfer'}</b>
        <div className="tp-pay-fields">
          <span><small>{p.method === 'MPESA_PAYBILL' ? 'Business no.' : p.method === 'MPESA_TILL' ? 'Till no.' : 'Account no.'}</small><CopyValue value={p.number} label="number" /></span>
          {p.method === 'MPESA_PAYBILL' && p.account && <span><small>Account no.</small><CopyValue value={p.account} label="account number" /></span>}
          {lease.account.balance > 0 && <span><small>Amount due</small><CopyValue value={String(lease.account.balance)} label="amount" /></span>}
        </div>
        {p.accountName && <small className="tp-pay-name">Paying {p.accountName}</small>}
        {p.method === 'MPESA_PAYBILL' && p.account === lease.code && <small className="tp-pay-name">Use your lease code as the account number so your payment is credited to you.</small>}
      </div>
    </div>
  );
}

/** A tenant's own tenancy: what they owe, when rent is due, where to pay and their statement. */
export default function TenantPortalPage() {
  const { data, isLoading } = useQuery({ queryKey: ['tenant-overview'], queryFn: getOverview });
  if (isLoading || !data) return <LoadingBlock />;

  const active = data.leases.filter((l) => l.status === 'ACTIVE');
  const past = data.leases.filter((l) => l.status !== 'ACTIVE');
  const first = data.tenant.name.split(' ')[0];

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader eyebrow="My tenancy" title={`Hi ${first}`} subtitle={<>Your landlord is <b style={{ color: 'var(--ink)' }}>{data.landlord.name}</b>{data.landlord.phone && <> · <Phone size={12} style={{ verticalAlign: -1 }} /> {data.landlord.phone}</>}</>} />

      {data.leases.length === 0 && (
        <div className="card"><EmptyState icon={<DoorOpen size={28} />} title="No lease yet" hint="Once your landlord creates your lease, your rent and statement will appear here." /></div>
      )}

      {active.map((l) => {
        const owes = l.account.balance > 0;
        return (
          <section key={l.id} className="card ux-summary">
            <div className="ux-id">
              <span className="ux-mark"><DoorOpen size={20} strokeWidth={1.75} /></span>
              <div style={{ minWidth: 0 }}>
                <h3>{l.unit.name} · {l.property.name}</h3>
                <p><span>Lease <span className="mono">{l.code}</span></span><span className="ux-sep" /><span>Since {fmtDay(l.startDate)}{l.endDate ? ` · ends ${fmtDay(l.endDate)}` : ''}</span>{l.meter && <><span className="ux-sep" /><span><Gauge size={12} style={{ verticalAlign: -1 }} /> Meter <span className="mono">{l.meter.meterNumber}</span></span></>}</p>
              </div>
            </div>
            <dl className="ux-kpis cl-kpis">
              <div>
                <dt>{owes ? 'You owe' : l.account.balance < 0 ? 'In credit' : 'Balance'}</dt>
                <dd><b style={{ color: owes ? 'var(--cl-bad)' : undefined }}>{fmtKes(Math.abs(l.account.balance))}</b></dd>
                <span className="ux-foot">{owes && l.account.arrears > 0 ? `${fmtKes(l.account.arrears)} overdue` : owes ? 'Due on or before the due date' : 'You’re up to date'}</span>
              </div>
              <div>
                <dt>Rent</dt>
                <dd><b>{fmtKes(l.rentAmount)}</b><span className="ux-unit">{FREQ_LABEL[l.billingFrequency].toLowerCase()}</span></dd>
                <span className="ux-foot">Due on day {l.dueDay}</span>
              </div>
              <div>
                <dt>Next charge</dt>
                {l.nextCharge
                  ? <><dd><b>{fmtKes(l.nextCharge.amount)}</b></dd><span className="ux-foot"><CalendarClock size={12} style={{ verticalAlign: -1 }} /> Due {fmtDay(l.nextCharge.dueDate)}</span></>
                  : <><dd><b>-</b></dd><span className="ux-foot">No further charges</span></>}
              </div>
              <div>
                <dt>Deposit held</dt>
                <dd><b>{fmtKes(l.account.depositHeld)}</b></dd>
                <span className="ux-foot">of {fmtKes(l.depositAmount)} agreed</span>
              </div>
            </dl>
            <div className="tp-pay-wrap"><h4>How to pay rent</h4><HowToPay lease={l} landlord={data.landlord} /></div>
          </section>
        );
      })}

      {data.leases.filter((l) => l.statement).map((l) => (
        <div key={`st-${l.id}`} className="card">
          <div className="card-head"><span className="card-title">Statement · {l.unit.name}</span><span className="text-xs" style={{ color: 'var(--muted)' }}>Latest first</span></div>
          {!l.statement?.length ? <EmptyState title="Nothing on your statement yet" /> : (
            <div className="tbl-wrap">
              <table className="tbl ut-table">
                <thead><tr><th>Date</th><th>Item</th><th className="num" style={{ textAlign: 'right' }}>Amount</th><th className="num" style={{ textAlign: 'right' }}>Balance</th></tr></thead>
                <tbody>
                  {l.statement.map((e) => {
                    const sign = entrySign(e.type);
                    return (
                      <tr key={e.id} style={{ opacity: e.reversed || e.isReversal ? 0.55 : 1 }}>
                        <td className="cl-date">{fmtDay(e.entryDate)}</td>
                        <td>
                          <span className="rn-strong" style={{ fontWeight: 500 }}>{TYPE_LABEL[e.type]}{e.isReversal ? ' (correction)' : e.reversed ? ' (corrected)' : ''}</span>
                          <span className="rn-sub">{[e.description, e.method ? METHOD_LABEL[e.method] : null, e.reference].filter(Boolean).join(' · ') || '-'}</span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="cl-amt">{sign < 0 ? '−' : sign > 0 ? '+' : ''}{fmtKes(Math.abs(e.amount))}</td>
                        <td style={{ textAlign: 'right' }} className="mono">{fmtKes(e.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {past.length > 0 && (
        <div className="card card-pad">
          <span className="card-title">Past tenancies</span>
          <ul className="tp-past">
            {past.map((l) => (
              <li key={l.id}><span>{l.unit.name} · {l.property.name}</span><small>{fmtDay(l.startDate)} – {l.endDate ? fmtDay(l.endDate) : 'ended'} · balance {fmtKes(l.account.balance)}</small></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
