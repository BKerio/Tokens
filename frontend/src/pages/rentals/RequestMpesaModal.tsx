import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { listLeases, requestLeaseStk } from '@/api/rentals';
import { fmtKes, toNum } from '@/lib/format';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import AppLoader from '@/components/shared/AppLoader';
import MpesaPay from '@/components/mpesa/MpesaPay';
import type { ReactNode } from 'react';
import type { Lease, RentClaimPurpose } from '@/types/api';

/**
 * Landlord / manager / accountant / caretaker sends the tenant an M-Pesa
 * prompt for rent or deposit. Once the tenant enters their PIN the payment is
 * posted to the lease and the tenant gets an SMS. Pass `lease`, or leave it
 * out to pick one first.
 */
export default function RequestMpesaModal({ lease: given, onClose }: { lease?: Lease | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { access, can } = useLandlordAccess();
  const [lease, setLease] = useState<Lease | null>(given ?? null);
  const [search, setSearch] = useState('');
  const canRent = can('payments.record');
  const canDeposit = can('deposits.manage');
  const [purpose, setPurpose] = useState<RentClaimPurpose>(canRent ? 'RENT' : 'DEPOSIT');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { data: options, isFetching } = useQuery({
    queryKey: ['leases', 'stk-picker', search],
    queryFn: () => listLeases({ status: 'ACTIVE', search: search || undefined, limit: 8 }),
    enabled: !lease,
  });

  const refresh = () => {
    for (const key of [['leases'], ['lease'], ['statement'], ['ledger'], ['arrears'], ['rent-report'], ['collections']]) queryClient.invalidateQueries({ queryKey: key });
  };

  const shell = (children: ReactNode) => (
    <div className="mp-overlay" onClick={onClose}>
      <div className="mp-shell" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Request M-Pesa payment">
        <button type="button" className="mp-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        {children}
      </div>
    </div>
  );

  // Step 0: choose whose rent.
  if (!lease) {
    return shell(
      <div className="mp-card">
        <div className="mp-title">
          <h1>Request M-Pesa</h1>
          <p>Choose the tenant to send a payment prompt to</p>
        </div>
        <label className="mp-field">
          <span className="mp-label">Tenant, unit or lease code</span>
          <span className="mp-input"><Search size={20} strokeWidth={1.5} /><input autoFocus placeholder="e.g. Jane or A4" value={search} onChange={(e) => setSearch(e.target.value)} /></span>
        </label>
        <div className="fs-picks" style={{ marginTop: 14 }}>
          {isFetching && !options ? <span className="fs-picks-empty"><AppLoader size={16} /> Searching…</span>
            : options?.data.length === 0 ? <span className="fs-picks-empty">No active leases match.</span>
              : options?.data.map((l) => (
                <button key={l.id} type="button" className="fs-pick" onClick={() => setLease(l)}>
                  <span className="fs-pick-av">{l.tenant.name.slice(0, 1).toUpperCase()}</span>
                  <span className="fs-pick-main"><b>{l.tenant.name}</b><small>{l.unit.name} · {l.property.name}</small></span>
                  <span className={`fs-pick-bal${l.account.balance > 0 ? ' owes' : ''}`}>{fmtKes(l.account.balance)}</span>
                </button>
              ))}
        </div>
      </div>,
    );
  }

  const balance = lease.account.balance;
  const depositDue = Math.max(0, toNum(lease.depositAmount) - lease.account.depositHeld);
  const rent = toNum(lease.rentAmount);
  const presets = purpose === 'RENT'
    ? [
        ...(balance > 0 ? [{ label: `Balance · ${fmtKes(Math.ceil(balance))}`, amount: Math.ceil(balance) }] : []),
        ...(rent > 0 && Math.ceil(rent) !== Math.ceil(balance) ? [{ label: `Rent · ${fmtKes(rent)}`, amount: rent }] : []),
      ]
    : depositDue > 0 ? [{ label: `Deposit due · ${fmtKes(Math.ceil(depositDue))}`, amount: Math.ceil(depositDue) }] : [];
  const suggested = purpose === 'RENT' ? (balance > 0 ? Math.ceil(balance) : rent) : Math.ceil(depositDue);

  return shell(
    <MpesaPay
      key={`${lease.id}-${purpose}`}
      title="Request M-Pesa"
      subtitle="Sends a payment prompt to the tenant’s phone"
      context={{
        label: purpose === 'RENT' ? 'Rent for' : 'Deposit for',
        title: lease.tenant.name,
        sub: `${lease.unit.name} · ${lease.property.name} · ${lease.code}`,
        right: purpose === 'RENT'
          ? { label: balance < 0 ? 'In credit' : 'Balance', value: fmtKes(Math.abs(balance)) }
          : { label: 'Deposit due', value: fmtKes(depositDue) },
      }}
      fields={canRent && canDeposit && lease.status === 'ACTIVE' ? (
        <div className="mp-field">
          <span className="mp-label">Payment for</span>
          <div className="mp-seg" role="radiogroup" aria-label="Payment for">
            <button type="button" role="radio" aria-checked={purpose === 'RENT'} className={purpose === 'RENT' ? 'on' : undefined} onClick={() => setPurpose('RENT')}>
              <b>Rent</b><small>{balance > 0 ? `${fmtKes(balance)} owed` : 'Up to date'}</small>
            </button>
            <button type="button" role="radio" aria-checked={purpose === 'DEPOSIT'} className={purpose === 'DEPOSIT' ? 'on' : undefined} onClick={() => setPurpose('DEPOSIT')}>
              <b>Deposit</b><small>{depositDue > 0 ? `${fmtKes(depositDue)} due` : 'Fully paid'}</small>
            </button>
          </div>
        </div>
      ) : undefined}
      defaultPhone={lease.tenant.phone}
      phoneLabel="Tenant’s M-Pesa number"
      defaultAmount={suggested > 0 ? String(Math.floor(suggested)) : ''}
      presets={presets}
      payLabel={(a) => `Send prompt for ${a ? fmtKes(a) : 'KES 0'}`}
      start={(phone, amount) => requestLeaseStk(lease.id, { purpose, amount, phone })}
      fromLabel={`${lease.tenant.name} · M-Pesa`}
      recipient={{ name: access?.landlordName ?? 'Landlord', detail: `${purpose === 'RENT' ? 'Rent' : 'Deposit'} · ${lease.unit.name} (${lease.code})` }}
      waitingText="Waiting for the tenant to enter their M-Pesa PIN…"
      successRows={(r, ctx) => [
        { label: 'Receipt no.', value: <span className="mono">{r.mpesaReceipt ?? 'Arriving shortly'}</span> },
        { label: 'Amount paid', value: fmtKes(r.amount ?? ctx.amount), strong: true },
        { label: 'Paid from', value: ctx.phone },
        { label: 'Tenant', value: `${lease.tenant.name} · ${lease.unit.name}` },
        { label: 'Statement', value: r.posted ? `Posted as ${purpose === 'RENT' ? 'rent' : 'deposit'}` : 'Being posted…' },
      ]}
      doneLabel="Done"
      onDone={() => { refresh(); onClose(); }}
      onBack={given ? undefined : () => setLease(null)}
    />,
  );
}
