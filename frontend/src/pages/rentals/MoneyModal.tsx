import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft, BadgePercent, Banknote, Building2, CircleEllipsis, Coins, HandCoins, Landmark, NotebookPen, PiggyBank, ReceiptText,
  ScrollText, Smartphone, Undo2, UserRound, Wrench, type LucideIcon,
} from 'lucide-react';
import { addCharge, addCredit, addExpense, depositAction, listLeases, recordPayment, type MoneyInput } from '@/api/rentals';
import { listProperties } from '@/api/properties';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { fmtKes, toNum } from '@/lib/format';
import { nairobiTodayISO } from '@/lib/datetime';
import AppLoader from '@/components/shared/AppLoader';
import { AmountInput, ChoiceChips, FormSheet, SheetField, SheetGrid, SheetNote, SheetSection, type SheetStep } from '@/components/shared/FormSheet';
import type { Lease, PaymentMethod } from '@/types/api';
import { CHARGE_CATEGORIES, EXPENSE_CATEGORIES, METHOD_LABEL } from './rentUi';

export type MoneyKind = 'payment' | 'charge' | 'credit' | 'deposit-in' | 'deposit-refund' | 'deposit-apply' | 'expense';

const KIND: Record<MoneyKind, { title: string; blurb: string; button: string; Icon: LucideIcon; method: boolean; reference: boolean }> = {
  payment: { title: 'Record a payment', blurb: 'Rent or charges paid by the tenant. It clears the oldest unpaid charges first.', button: 'Record payment', Icon: HandCoins, method: true, reference: true },
  charge: { title: 'Add a charge', blurb: 'Bill the tenant for something other than rent, such as water or a penalty.', button: 'Add charge', Icon: ReceiptText, method: false, reference: false },
  credit: { title: 'Give a credit', blurb: 'Reduce what the tenant owes, such as a discount or goodwill credit.', button: 'Add credit', Icon: BadgePercent, method: false, reference: false },
  'deposit-in': { title: 'Receive a deposit', blurb: 'Money held as security. It does not reduce the tenant’s balance.', button: 'Record deposit', Icon: PiggyBank, method: true, reference: true },
  'deposit-refund': { title: 'Refund the deposit', blurb: 'Pay back some or all of the deposit you are holding.', button: 'Record refund', Icon: Undo2, method: true, reference: true },
  'deposit-apply': { title: 'Use deposit for the balance', blurb: 'Move held deposit onto the tenant’s balance, usually when they move out.', button: 'Apply deposit', Icon: ArrowRightLeft, method: false, reference: false },
  expense: { title: 'Record an expense', blurb: 'Money spent on a property, such as repairs, security or utilities.', button: 'Record expense', Icon: Wrench, method: true, reference: true },
};

const METHOD_ICON: Record<PaymentMethod, LucideIcon> = { MPESA: Smartphone, CASH: Banknote, BANK: Landmark, CHEQUE: ScrollText, OTHER: CircleEllipsis };

/**
 * One form for every money entry. Pass `lease` for tenant entries (or leave it
 * out to pick an active lease), or nothing for an expense (pick a property).
 */
export function MoneyModal({ kind, lease, onClose }: { kind: MoneyKind; lease?: Lease | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const cfg = KIND[kind];
  const [leaseId, setLeaseId] = useState(lease?.id ?? '');
  const [picked, setPicked] = useState<Lease | null>(lease ?? null);
  const [leaseSearch, setLeaseSearch] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [amount, setAmount] = useState(kind === 'payment' && lease && lease.account.balance > 0 ? String(lease.account.balance) : '');
  const [date, setDate] = useState(nairobiTodayISO());
  const [method, setMethod] = useState<PaymentMethod>('MPESA');
  const [reference, setReference] = useState('');
  const [category, setCategory] = useState(kind === 'expense' ? EXPENSE_CATEGORIES[0]! : kind === 'charge' ? CHARGE_CATEGORIES[0]! : '');
  const [description, setDescription] = useState('');
  const [tried, setTried] = useState(false);

  const needsLease = kind !== 'expense' && !lease;
  const { data: leaseOptions, isFetching: searching } = useQuery({
    queryKey: ['leases', 'picker', leaseSearch],
    queryFn: () => listLeases({ status: 'ACTIVE', search: leaseSearch || undefined, limit: 8 }),
    enabled: needsLease,
  });
  const { data: properties = [] } = useQuery({ queryKey: ['properties', ''], queryFn: () => listProperties(), enabled: kind === 'expense' });
  const current = lease ?? picked;

  const save = useMutation({
    mutationFn: async () => {
      const base: MoneyInput = { amount: Number(amount), date, description: description || undefined };
      const paid = { ...base, method: cfg.method ? method : undefined, reference: cfg.reference && reference ? reference : undefined };
      switch (kind) {
        case 'payment': return recordPayment(leaseId, paid);
        case 'charge': return addCharge(leaseId, { ...base, category });
        case 'credit': return addCredit(leaseId, base);
        case 'deposit-in': return depositAction(leaseId, { ...paid, action: 'RECEIVED' });
        case 'deposit-refund': return depositAction(leaseId, { ...paid, action: 'REFUND' });
        case 'deposit-apply': return depositAction(leaseId, { ...base, action: 'APPLIED' });
        case 'expense': return addExpense({ ...paid, propertyId, category });
      }
    },
    onSuccess: () => {
      for (const key of [['leases'], ['lease'], ['statement'], ['ledger'], ['arrears'], ['rent-report']]) queryClient.invalidateQueries({ queryKey: key });
      notify('success', `${cfg.button.replace(/^Record |^Add |^Apply /, '').replace(/^./, (c) => c.toUpperCase())} saved`);
      onClose();
    },
    onError: (err) => notify('error', 'Could not save', errorMessage(err)),
  });

  const value = Number(amount) || 0;
  const balance = current?.account.balance ?? 0;
  const held = current?.account.depositHeld ?? 0;
  const rent = toNum(current?.rentAmount ?? 0);
  const agreedDeposit = toNum(current?.depositAmount ?? 0);

  // Quick-fill amounts that make sense for this kind of entry.
  const presets: { label: string; amount: number }[] = [];
  if (current) {
    if (kind === 'payment') {
      if (balance > 0) presets.push({ label: `Full balance · ${fmtKes(balance)}`, amount: balance });
      if (rent > 0 && rent !== balance) presets.push({ label: `One period’s rent · ${fmtKes(rent)}`, amount: rent });
    }
    if (kind === 'deposit-in' && agreedDeposit - held > 0) presets.push({ label: `Agreed deposit · ${fmtKes(agreedDeposit - held)}`, amount: agreedDeposit - held });
    if (kind === 'deposit-refund' && held > 0) presets.push({ label: `All held · ${fmtKes(held)}`, amount: held });
    if (kind === 'deposit-apply' && held > 0) {
      const cover = Math.min(held, balance);
      if (cover > 0) presets.push({ label: `Cover balance · ${fmtKes(cover)}`, amount: cover });
      if (held !== cover) presets.push({ label: `All held · ${fmtKes(held)}`, amount: held });
    }
  }

  const whoDone = kind === 'expense' ? !!propertyId : !!leaseId;
  const amountDone = value > 0;
  const steps: SheetStep[] = [
    ...(needsLease || kind === 'expense'
      ? [{ id: 'who', title: kind === 'expense' ? 'Property' : 'Tenant', Icon: kind === 'expense' ? Building2 : UserRound, done: whoDone }]
      : []),
    { id: 'amount', title: 'Amount', Icon: Coins, done: amountDone },
    { id: 'details', title: 'Details', Icon: NotebookPen, done: !!date && amountDone },
  ];

  const errors = {
    who: tried && !whoDone ? (kind === 'expense' ? 'Choose the property' : 'Choose the tenant’s lease') : undefined,
    amount: tried && !amountDone ? 'Enter an amount above zero' : undefined,
    date: tried && !date ? 'Choose the date' : undefined,
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (whoDone && amountDone && date) save.mutate();
  };

  // Live effect on the tenant's account, shown in the footer.
  const after = (() => {
    if (!current || !value) return null;
    if (kind === 'payment' || kind === 'credit' || kind === 'deposit-apply') return { label: 'Balance after', amount: balance - value };
    if (kind === 'charge') return { label: 'Balance after', amount: balance + value };
    if (kind === 'deposit-in') return { label: 'Deposit held after', amount: held + value };
    if (kind === 'deposit-refund') return { label: 'Deposit held after', amount: held - value };
    return null;
  })();

  return (
    <FormSheet
      icon={cfg.Icon}
      title={lease ? `${cfg.title} · ${lease.tenant.name}` : cfg.title}
      subtitle={cfg.blurb}
      steps={steps}
      width={640}
      onClose={onClose}
      onSubmit={submit}
      busy={save.isPending}
      submitLabel={cfg.button}
      meta={after
        ? <><Coins size={15} /> {after.label} <b style={{ color: after.amount < 0 ? 'var(--red)' : undefined }}>{fmtKes(after.amount)}</b></>
        : <><Coins size={15} /> <b>{value ? fmtKes(value) : 'No amount yet'}</b></>}
    >
      {current && (
        <div className="fs-context">
          <span className="fs-context-av">{current.tenant.name.slice(0, 1).toUpperCase()}</span>
          <span className="fs-context-main"><b>{current.tenant.name}</b><small>{current.unit.name} · {current.property.name} · <span className="mono">{current.code}</span></small></span>
          <span className="fs-context-figs">
            <span><small>Balance</small><b style={{ color: balance > 0 ? 'var(--red)' : '#157347' }}>{fmtKes(balance)}</b></span>
            <span><small>Deposit held</small><b>{fmtKes(held)}</b></span>
          </span>
        </div>
      )}

      {needsLease && (
        <SheetSection id="who">
          <SheetField label="Find the tenant" required hint="Search by tenant name, unit or lease code" error={errors.who}>
            <input className="input" placeholder="e.g. Jane, A4 or 7KX9P2Q" value={leaseSearch} onChange={(e) => setLeaseSearch(e.target.value)} />
          </SheetField>
          <div className="fs-picks">
            {searching && !leaseOptions ? <span className="fs-picks-empty"><AppLoader size={16} /> Searching…</span>
              : leaseOptions?.data.length === 0 ? <span className="fs-picks-empty">No active leases match.</span>
                : leaseOptions?.data.map((l) => (
                  <button key={l.id} type="button" className={`fs-pick${leaseId === l.id ? ' on' : ''}`} onClick={() => { setLeaseId(l.id); setPicked(l); }}>
                    <span className="fs-pick-av">{l.tenant.name.slice(0, 1).toUpperCase()}</span>
                    <span className="fs-pick-main"><b>{l.tenant.name}</b><small>{l.unit.name} · {l.property.name}</small></span>
                    <span className={`fs-pick-bal${l.account.balance > 0 ? ' owes' : ''}`}>{fmtKes(l.account.balance)}</span>
                  </button>
                ))}
          </div>
        </SheetSection>
      )}

      {kind === 'expense' && (
        <SheetSection id="who">
          <SheetField label="Which property?" required error={errors.who}>
            <select className="eoc-select" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Choose a property…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </SheetField>
        </SheetSection>
      )}

      <SheetSection id="amount">
        <AmountInput value={amount} onChange={setAmount} presets={presets} autoFocus={!needsLease && kind !== 'expense'} />
        {errors.amount && <span className="field-error">{errors.amount}</span>}
        {(kind === 'expense' || kind === 'charge') && (
          <div className="vf-field">
            <span className="vf-label">Category</span>
            <ChoiceChips value={category} onChange={setCategory} label="Category" options={(kind === 'expense' ? EXPENSE_CATEGORIES : CHARGE_CATEGORIES).map((c) => ({ value: c, label: c }))} />
          </div>
        )}
      </SheetSection>

      <SheetSection id="details">
        {cfg.method && (
          <div className="vf-field">
            <span className="vf-label">{kind === 'expense' || kind === 'deposit-refund' ? 'Paid out by' : 'Paid by'}</span>
            <div className="fs-methods">
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => {
                const Icon = METHOD_ICON[m];
                return (
                  <button key={m} type="button" className={`fs-method${method === m ? ' on' : ''}`} onClick={() => setMethod(m)}>
                    <Icon size={18} />{METHOD_LABEL[m]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <SheetGrid>
          <SheetField label="Date" required error={errors.date}>
            <input className="input" type="date" value={date} max={nairobiTodayISO()} onChange={(e) => setDate(e.target.value)} />
          </SheetField>
          {cfg.reference && (
            <SheetField label={method === 'MPESA' ? 'M-Pesa receipt' : 'Reference'} hint={method === 'MPESA' ? 'Stops the same receipt being recorded twice' : 'Cheque or transfer number'}>
              <input className="input mono" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder={method === 'MPESA' ? 'e.g. QJK7XB2LMN' : ''} />
            </SheetField>
          )}
        </SheetGrid>
        <SheetField label="Note" aside="Optional">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === 'expense' ? 'e.g. Replaced gate motor' : 'Shown on the statement'} />
        </SheetField>
        {(kind === 'deposit-apply' || kind === 'deposit-refund') && value > held && (
          <SheetNote tone="warn">That’s more than the {fmtKes(held)} deposit held.</SheetNote>
        )}
      </SheetSection>
    </FormSheet>
  );
}
