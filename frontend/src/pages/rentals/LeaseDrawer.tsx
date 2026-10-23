import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarDays, CirclePlus, Coins, HandCoins, Pencil, PiggyBank, ReceiptText, Smartphone, Tag, Undo2, Wallet } from 'lucide-react';
import { getLease, getStatement, reverseEntry, terminateLease, updateLease } from '@/api/rentals';
import { errorMessage } from '@/api/client';
import { notify, promptDialog } from '@/lib/alert';
import { fmtKes, toNum } from '@/lib/format';
import { nairobiTodayISO } from '@/lib/datetime';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { AmountInput, ChoiceChips, FormSheet, SheetField, SheetNote, SheetSection } from '@/components/shared/FormSheet';
import { Drawer, LoadingBlock } from '@/components/shared/ui';
import type { BillingFrequency, Lease } from '@/types/api';
import { AgingBar, FREQ_LABEL, FREQ_SHORT, METHOD_LABEL, TYPE_LABEL, TYPE_PILL, entrySign, fmtDay } from './rentUi';
import { MoneyModal, type MoneyKind } from './MoneyModal';
import RequestMpesaModal from './RequestMpesaModal';

function EditTermsModal({ lease, onClose }: { lease: Lease; onClose: () => void }) {
  const queryClient = useQueryClient();
  const current = toNum(lease.rentAmount);
  const [rent, setRent] = useState(String(current));
  const [frequency, setFrequency] = useState<BillingFrequency>(lease.billingFrequency);
  const [dueDay, setDueDay] = useState(String(lease.dueDay));
  const [endDate, setEndDate] = useState(lease.endDate?.slice(0, 10) ?? '');
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: () => updateLease(lease.id, { rentAmount: Number(rent), billingFrequency: frequency, dueDay: Number(dueDay), endDate: endDate || null }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['lease', lease.id] }); queryClient.invalidateQueries({ queryKey: ['leases'] }); notify('success', 'Terms updated', 'Applies from the next billing period.'); onClose(); },
    onError: (err) => notify('error', 'Could not update', errorMessage(err)),
  });
  const rentN = Number(rent) || 0;
  const rentBad = !(rentN > 0);
  const dueBad = !(Number(dueDay) >= 1 && Number(dueDay) <= 28);
  const change = rentN - current;
  return (
    <FormSheet
      icon={Pencil}
      title={`Edit terms · ${lease.code}`}
      subtitle="Changes apply to periods not yet billed. Correct past charges with a credit or a reversal."
      steps={[
        { id: 'rent', title: 'Rent', Icon: Coins, done: !rentBad && !dueBad },
        { id: 'term', title: 'Term', Icon: CalendarDays, done: true },
      ]}
      width={620}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); setTried(true); if (!rentBad && !dueBad) save.mutate(); }}
      busy={save.isPending}
      submitLabel="Save terms"
      meta={change === 0
        ? <><Coins size={15} /> Rent unchanged</>
        : <><Coins size={15} /> Rent <b style={{ color: change > 0 ? 'var(--red)' : '#157347' }}>{change > 0 ? '+' : '−'}{fmtKes(Math.abs(change))}</b> per period</>}
    >
      <SheetSection id="rent">
        <div className="vf-field">
          <span className="vf-label">Bill rent</span>
          <ChoiceChips value={frequency} onChange={setFrequency} label="Billing frequency" options={(Object.keys(FREQ_LABEL) as BillingFrequency[]).map((f) => ({ value: f, label: FREQ_LABEL[f] }))} />
        </div>
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Rent per period <b> *</b></span><small>Now {fmtKes(current)}</small></span>
          <AmountInput value={rent} onChange={setRent} label="Rent" presets={[{ label: `Keep ${fmtKes(current)}`, amount: current }]} />
          {tried && rentBad && <span className="field-error">Enter the rent</span>}
        </div>
        <SheetField label="Due on day" hint="1 to 28, so it exists in every month" error={tried && dueBad ? 'Pick a day from 1 to 28' : undefined}>
          <input className="input mono" inputMode="numeric" style={{ maxWidth: 140 }} value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </SheetField>
      </SheetSection>
      <SheetSection id="term">
        <SheetField label="Lease ends" hint="Leave blank for a rolling tenancy">
          <input className="input" type="date" value={endDate} min={lease.startDate.slice(0, 10)} onChange={(e) => setEndDate(e.target.value)} />
        </SheetField>
        {endDate && <button type="button" className="vf-chip" style={{ alignSelf: 'flex-start' }} onClick={() => setEndDate('')}><i />Make it rolling</button>}
      </SheetSection>
    </FormSheet>
  );
}

const END_REASONS = ['Tenant moved out', 'Lease expired', 'Non-payment', 'Moved to another unit'];

function EndLeaseModal({ lease, onClose }: { lease: Lease; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [endDate, setEndDate] = useState(nairobiTodayISO());
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const end = useMutation({
    mutationFn: () => terminateLease(lease.id, { endDate, reason }),
    onSuccess: () => {
      for (const key of [['lease', lease.id], ['leases'], ['statement', lease.id], ['vacant-units'], ['arrears'], ['rent-report'], ['property-units']]) queryClient.invalidateQueries({ queryKey: key });
      notify('success', `Lease ${lease.code} ended`, `${lease.unit.name} is vacant again.`);
      onClose();
    },
    onError: (err) => notify('error', 'Could not end lease', errorMessage(err)),
  });
  const reasonBad = reason.trim().length < 3;
  const held = lease.account.depositHeld;
  return (
    <FormSheet
      icon={Ban}
      danger
      title={`End lease · ${lease.tenant.name}`}
      subtitle={<>{lease.unit.name} · {lease.property.name}. Billing stops on the last day; rent already charged past it is credited back automatically.</>}
      width={600}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); setTried(true); if (!reasonBad) end.mutate(); }}
      busy={end.isPending}
      submitLabel="End lease"
      submitIcon={false}
      meta={<><Ban size={15} /> Balance <b>{fmtKes(lease.account.balance)}</b> · deposit held <b>{fmtKes(held)}</b></>}
    >
      <SheetSection id="end" title="Move-out" Icon={CalendarDays}>
        <SheetField label="Last day of tenancy" required>
          <input className="input" type="date" value={endDate} min={lease.startDate.slice(0, 10)} onChange={(e) => setEndDate(e.target.value)} />
        </SheetField>
        <div className="vf-field">
          <span className="vf-label">Reason <b> *</b></span>
          <ChoiceChips value={END_REASONS.includes(reason) ? reason : ''} onChange={setReason} label="Reason" options={END_REASONS.map((r) => ({ value: r, label: r }))} />
          <input className="input" placeholder="Or type a reason…" value={END_REASONS.includes(reason) ? '' : reason} onChange={(e) => setReason(e.target.value)} />
          {tried && reasonBad && <span className="field-error">Give a short reason</span>}
        </div>
        {held > 0 && (
          <SheetNote tone="warn">
            You’re holding a <b>{fmtKes(held)}</b> deposit. After ending the lease, refund it or use it against the balance from the lease’s actions.
          </SheetNote>
        )}
      </SheetSection>
    </FormSheet>
  );
}

/** Lease detail: account, actions (by permission) and the running-balance statement. */
export default function LeaseDrawer({ leaseId, onClose }: { leaseId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { can } = useLandlordAccess();
  const { data: lease, isLoading } = useQuery({ queryKey: ['lease', leaseId], queryFn: () => getLease(leaseId) });
  const { data: statement } = useQuery({ queryKey: ['statement', leaseId], queryFn: () => getStatement(leaseId), enabled: can('ledger.view') });
  const [money, setMoney] = useState<MoneyKind | null>(null);
  const [prompting, setPrompting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => reverseEntry(id, reason),
    onSuccess: () => {
      for (const key of [['lease', leaseId], ['statement', leaseId], ['leases'], ['ledger'], ['arrears'], ['rent-report']]) queryClient.invalidateQueries({ queryKey: key });
      notify('success', 'Entry reversed');
    },
    onError: (err) => notify('error', 'Could not reverse', errorMessage(err)),
  });

  const askReverse = async (id: string, label: string) => {
    const reason = await promptDialog({ title: `Reverse ${label}?`, text: 'A matching negative entry is posted; the original stays on record.', inputLabel: 'Reason', confirmLabel: 'Reverse', minLength: 3 });
    if (reason) reverse.mutate({ id, reason });
  };

  if (isLoading || !lease) return <Drawer title="Lease" onClose={onClose} width={640}><LoadingBlock height={360} /></Drawer>;
  const active = lease.status === 'ACTIVE';
  const a = lease.account;

  return (
    <Drawer title={`${lease.tenant.name} · ${lease.unit.name}`} onClose={onClose} width={680}>
      <div className="rn-lease-head">
        <span className={`pill ${active ? 'pill-green' : 'pill-gray'}`}><span className="dot" />{lease.status === 'ACTIVE' ? 'Active' : lease.status === 'ENDED' ? 'Ended' : 'Terminated'}</span>
        <span className="mono rn-code" title="Lease code (paybill account no.)">{lease.code}</span>
        <span className="rn-muted">{lease.property.name}{lease.property.locationGroup ? ` · ${lease.property.locationGroup.name}` : ''}</span>
      </div>

      <div className="rn-tiles">
        <div className={`rn-tile${a.balance > 0 ? ' warn' : ''}`}><small>Balance</small><b>{fmtKes(a.balance)}</b><em>{a.balance < 0 ? 'in credit' : a.balance > 0 ? 'owed' : 'settled'}</em></div>
        <div className={`rn-tile${a.arrears > 0 ? ' bad' : ''}`}><small>Arrears</small><b>{fmtKes(a.arrears)}</b><em>{a.oldestUnpaidDue ? `since ${fmtDay(a.oldestUnpaidDue)}` : 'none overdue'}</em></div>
        <div className="rn-tile"><small>Deposit held</small><b>{fmtKes(a.depositHeld)}</b><em>of {fmtKes(lease.depositAmount)}</em></div>
        <div className="rn-tile"><small>Next charge</small><b>{lease.nextCharge ? fmtKes(lease.nextCharge.amount) : '-'}</b><em>{lease.nextCharge ? `due ${fmtDay(lease.nextCharge.dueDate)}` : 'no further billing'}</em></div>
      </div>

      {a.arrears > 0 && <AgingBar aging={a.aging} />}

      <div className="rn-actions">
        {active && (can('payments.record') || can('deposits.manage')) && <button className="btn btn-primary btn-sm" onClick={() => setPrompting(true)}><Smartphone size={14} /> M-Pesa prompt</button>}
        {can('payments.record') && <button className="btn btn-ghost btn-sm" onClick={() => setMoney('payment')}><HandCoins size={14} /> Record payment</button>}
        {can('charges.manage') && <button className="btn btn-ghost btn-sm" onClick={() => setMoney('charge')}><CirclePlus size={14} /> Charge</button>}
        {can('charges.manage') && <button className="btn btn-ghost btn-sm" onClick={() => setMoney('credit')}><Tag size={14} /> Credit</button>}
        {can('deposits.manage') && <button className="btn btn-ghost btn-sm" onClick={() => setMoney('deposit-in')}><PiggyBank size={14} /> Deposit in</button>}
        {can('deposits.manage') && a.depositHeld > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setMoney('deposit-refund')}><Wallet size={14} /> Refund deposit</button>}
        {can('deposits.manage') && a.depositHeld > 0 && a.balance > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setMoney('deposit-apply')}><ReceiptText size={14} /> Apply deposit</button>}
        {active && can('leases.manage') && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit terms</button>}
        {active && can('leases.manage') && <button className="btn btn-ghost btn-sm rn-danger" onClick={() => setEnding(true)}><Ban size={14} /> End lease</button>}
      </div>

      <dl className="rn-facts">
        <div><dt>Tenant</dt><dd>{lease.tenant.name}<small>{lease.tenant.phone}{lease.tenant.email ? ` · ${lease.tenant.email}` : ''}{lease.tenant.idNumber ? ` · ID ${lease.tenant.idNumber}` : ''}</small></dd></div>
        <div><dt>Rent</dt><dd>{fmtKes(lease.rentAmount)}{FREQ_SHORT[lease.billingFrequency]}<small>{FREQ_LABEL[lease.billingFrequency]}, due on day {lease.dueDay}</small></dd></div>
        <div><dt>Tenancy</dt><dd>{fmtDay(lease.startDate)} – {lease.endDate ? fmtDay(lease.endDate) : 'rolling'}{lease.terminationReason && <small>Ended: {lease.terminationReason}</small>}</dd></div>
        {lease.notes && <div><dt>Notes</dt><dd>{lease.notes}</dd></div>}
      </dl>

      {statement && (
        <section>
          <h4 className="rn-subhead">Statement</h4>
          {statement.entries.length === 0 ? <p className="rn-muted">No entries yet.</p> : (
            <div className="tbl-wrap">
              <table className="tbl rn-statement">
                <thead><tr><th>Date</th><th>Entry</th><th style={{ textAlign: 'right' }}>Charged</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Balance</th><th /></tr></thead>
                <tbody>
                  {[...statement.entries].reverse().map((e) => {
                    const sign = entrySign(e.type);
                    const amt = toNum(e.amount);
                    return (
                      <tr key={e.id} className={e.reversed || e.reversalOfId ? 'rn-struck' : undefined}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(e.entryDate, { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                        <td>
                          <span className={TYPE_PILL[e.type]}>{TYPE_LABEL[e.type]}</span>
                          <span className="rn-entry-desc">{e.description ?? (e.category ? e.category : '')}{e.method ? ` · ${METHOD_LABEL[e.method]}` : ''}{e.reference ? ` · ${e.reference}` : ''}</span>
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{sign > 0 ? fmtKes(amt) : sign === 0 ? <span className="rn-muted">{fmtKes(amt)}</span> : ''}</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#157347' }}>{sign < 0 ? fmtKes(amt) : ''}</td>
                        <td className="mono strong" style={{ textAlign: 'right' }}>{fmtKes(e.balance ?? 0)}</td>
                        <td>{can('entries.reverse') && !e.reversed && !e.reversalOfId && (
                          <button className="icon-btn" title="Reverse entry" onClick={() => askReverse(e.id, TYPE_LABEL[e.type].toLowerCase())}><Undo2 size={13} /></button>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {money && <MoneyModal kind={money} lease={lease} onClose={() => setMoney(null)} />}
      {prompting && <RequestMpesaModal lease={lease} onClose={() => setPrompting(false)} />}
      {editing && <EditTermsModal lease={lease} onClose={() => setEditing(false)} />}
      {ending && <EndLeaseModal lease={lease} onClose={() => setEnding(false)} />}
    </Drawer>
  );
}
