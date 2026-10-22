import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CalendarDays, CircleEllipsis, Coins, DoorOpen, FileSignature, Landmark, PiggyBank, ScrollText, Smartphone, UserPlus, UserRound, Users, type LucideIcon } from 'lucide-react';
import { createLease, listTenantDirectory, listVacantUnits, type LeaseInput } from '@/api/rentals';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { fmtKes, toNum } from '@/lib/format';
import { nairobiTodayISO } from '@/lib/datetime';
import AppLoader from '@/components/shared/AppLoader';
import { AmountInput, ChoiceChips, ChoiceTiles, FormSheet, SheetField, SheetGrid, SheetNote, SheetSection, type SheetStep } from '@/components/shared/FormSheet';
import type { BillingFrequency, Lease, PaymentMethod } from '@/types/api';
import { FREQ_LABEL, METHOD_LABEL } from './rentUi';

const METHOD_ICON: Record<PaymentMethod, LucideIcon> = { MPESA: Smartphone, CASH: Banknote, BANK: Landmark, CHEQUE: ScrollText, OTHER: CircleEllipsis };
const DUE_DAYS = ['1', '5', '10', '15'];

const firstOfNextMonth = () => {
  const [y, m] = nairobiTodayISO().split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
};

/** `iso` + `months`, minus one day (the last day of a fixed term). */
const termEnd = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** New lease: vacant unit → tenant (new or existing) → rent → deposit → dates. */
export default function LeaseFormModal({ onClose, onCreated, presetUnitId }: { onClose: () => void; onCreated?: (l: Lease) => void; presetUnitId?: string }) {
  const queryClient = useQueryClient();
  const { data: units = [], isLoading: unitsLoading } = useQuery({ queryKey: ['vacant-units'], queryFn: () => listVacantUnits() });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenant-directory'], queryFn: listTenantDirectory });

  const [unitId, setUnitId] = useState(presetUnitId ?? '');
  const [unitSearch, setUnitSearch] = useState('');
  const [tenantMode, setTenantMode] = useState<'new' | 'existing'>('new');
  const [tenantId, setTenantId] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenant, setTenant] = useState({ name: '', phone: '', email: '', idNumber: '' });
  const [rent, setRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [frequency, setFrequency] = useState<BillingFrequency>('MONTHLY');
  const [dueDay, setDueDay] = useState('5');
  const [startDate, setStartDate] = useState(nairobiTodayISO());
  const [endDate, setEndDate] = useState('');
  const [existingTenancy, setExistingTenancy] = useState(false);
  const [billFrom, setBillFrom] = useState(firstOfNextMonth());
  const [notes, setNotes] = useState('');
  const [depositNow, setDepositNow] = useState(true);
  const [depMethod, setDepMethod] = useState<PaymentMethod>('MPESA');
  const [depRef, setDepRef] = useState('');
  const [tried, setTried] = useState(false);

  const unit = units.find((u) => u.id === unitId);
  const shownUnits = useMemo(() => {
    const q = unitSearch.trim().toLowerCase();
    return units.filter((u) => !q || u.name.toLowerCase().includes(q) || u.property.name.toLowerCase().includes(q)).slice(0, 12);
  }, [units, unitSearch]);
  const shownTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    return tenants.filter((t) => !q || t.name.toLowerCase().includes(q) || t.phone.includes(q)).slice(0, 8);
  }, [tenants, tenantSearch]);

  const chooseUnit = (id: string) => {
    setUnitId(id);
    const u = units.find((x) => x.id === id);
    if (u?.monthlyRent && !rent) setRent(String(toNum(u.monthlyRent)));
    if (u?.depositAmount && !deposit) setDeposit(String(toNum(u.depositAmount)));
  };

  const rentN = Number(rent) || 0;
  const depositN = Number(deposit) || 0;
  const problems = {
    unit: !unitId ? 'Choose the unit' : null,
    tenant: tenantMode === 'new'
      ? (!tenant.name.trim() ? 'Enter the tenant’s name' : tenant.phone.replace(/\D/g, '').length < 9 ? 'Enter a phone number' : null)
      : !tenantId ? 'Choose a tenant' : null,
    rent: !(rentN > 0) ? 'Enter the rent' : null,
    dueDay: !(Number(dueDay) >= 1 && Number(dueDay) <= 28) ? 'Pick a day from 1 to 28' : null,
    endDate: endDate && endDate <= startDate ? 'Must be after the start date' : null,
    billFrom: existingTenancy && billFrom < startDate ? 'Cannot be before the start date' : null,
  };
  const show = (k: keyof typeof problems) => (tried ? problems[k] ?? undefined : undefined);
  const valid = !Object.values(problems).some(Boolean);

  const steps: SheetStep[] = [
    { id: 'unit', title: 'Unit', Icon: DoorOpen, done: !problems.unit },
    { id: 'tenant', title: 'Tenant', Icon: UserRound, done: !problems.tenant },
    { id: 'rent', title: 'Rent', Icon: Coins, done: !problems.rent && !problems.dueDay },
    { id: 'deposit', title: 'Deposit', Icon: PiggyBank, done: deposit !== '' },
    { id: 'dates', title: 'Dates', Icon: CalendarDays, done: !!startDate && !problems.endDate && !problems.billFrom },
  ];

  const save = useMutation({
    mutationFn: () => {
      const input: LeaseInput = {
        unitId,
        ...(tenantMode === 'existing'
          ? { tenantId }
          : { tenant: { name: tenant.name.trim(), phone: tenant.phone.trim(), email: tenant.email || null, idNumber: tenant.idNumber || null } }),
        rentAmount: rentN,
        depositAmount: depositN,
        billingFrequency: frequency,
        dueDay: Number(dueDay),
        startDate,
        endDate: endDate || null,
        billFrom: existingTenancy ? billFrom : undefined,
        notes: notes || undefined,
        depositReceived: depositNow && depositN > 0 ? { amount: depositN, method: depMethod, reference: depRef || undefined } : undefined,
      };
      return createLease(input);
    },
    onSuccess: (lease) => {
      for (const key of [['leases'], ['vacant-units'], ['ledger'], ['arrears'], ['rent-report'], ['tenant-directory'], ['locations'], ['property-units']]) queryClient.invalidateQueries({ queryKey: key });
      notify('success', `Lease ${lease.code} created`, `${lease.tenant.name} · ${lease.unit.name}. Rent is now billed automatically.`);
      onCreated?.(lease);
      onClose();
    },
    onError: (err) => notify('error', 'Could not create lease', errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (valid) save.mutate();
  };

  const tenantName = tenantMode === 'new' ? tenant.name.trim() : tenants.find((t) => t.id === tenantId)?.name;
  const periodWord = frequency === 'MONTHLY' ? 'month' : frequency === 'QUARTERLY' ? 'quarter' : frequency === 'SEMI_ANNUAL' ? 'half-year' : 'year';

  return (
    <FormSheet
      icon={FileSignature}
      title="New lease"
      subtitle="Let a vacant unit. Rent is then charged automatically on schedule."
      steps={steps}
      width={760}
      onClose={onClose}
      onSubmit={submit}
      busy={save.isPending}
      submitLabel="Create lease"
      meta={rentN > 0
        ? <><Coins size={15} /> Move-in <b>{fmtKes(rentN + depositN)}</b>{tenantName && <> · {tenantName}</>}</>
        : <><FileSignature size={15} /> <b>{unit ? `${unit.name} · ${unit.property.name}` : 'No unit chosen'}</b></>}
    >
      <SheetSection id="unit" aside={units.length ? `${units.length} vacant` : undefined}>
        {unitsLoading ? <span className="fs-picks-empty"><AppLoader size={16} /> Loading vacant units…</span> : units.length === 0 ? (
          <SheetNote tone="warn">Every unit has an active lease. Add units on the <b>Units</b> page first.</SheetNote>
        ) : (
          <>
            {units.length > 6 && (
              <input className="input" placeholder="Search unit or property…" value={unitSearch} onChange={(e) => setUnitSearch(e.target.value)} />
            )}
            <div className="fs-picks">
              {shownUnits.length === 0 && <span className="fs-picks-empty">No vacant units match.</span>}
              {shownUnits.map((u) => (
                <button key={u.id} type="button" className={`fs-pick${unitId === u.id ? ' on' : ''}`} onClick={() => chooseUnit(u.id)}>
                  <span className="fs-pick-av"><DoorOpen size={15} /></span>
                  <span className="fs-pick-main"><b>{u.name}</b><small>{u.property.name}</small></span>
                  <span className="fs-pick-bal">{u.monthlyRent ? fmtKes(u.monthlyRent) : 'No rent set'}</span>
                </button>
              ))}
            </div>
            {show('unit') && <span className="field-error">{show('unit')}</span>}
          </>
        )}
      </SheetSection>

      <SheetSection id="tenant">
        <ChoiceTiles
          value={tenantMode}
          onChange={setTenantMode}
          cols={2}
          label="Tenant"
          options={[
            { value: 'new', label: 'New tenant', hint: 'Add their details now', Icon: UserPlus },
            { value: 'existing', label: 'Existing tenant', hint: tenants.length ? `${tenants.length} on file` : 'None on file yet', Icon: Users },
          ]}
        />
        {tenantMode === 'new' ? (
          <SheetGrid>
            <SheetField label="Full name" required error={show('tenant') && !tenant.name.trim() ? show('tenant') : undefined}>
              <input className="input" autoComplete="off" value={tenant.name} onChange={(e) => setTenant({ ...tenant, name: e.target.value })} />
            </SheetField>
            <SheetField label="Phone" required error={show('tenant') && tenant.name.trim() ? show('tenant') : undefined}>
              <input className="input" inputMode="tel" placeholder="07XX XXX XXX" value={tenant.phone} onChange={(e) => setTenant({ ...tenant, phone: e.target.value })} />
            </SheetField>
            <SheetField label="Email" aside="Optional">
              <input className="input" type="email" value={tenant.email} onChange={(e) => setTenant({ ...tenant, email: e.target.value })} />
            </SheetField>
            <SheetField label="ID / passport no." aside="Optional">
              <input className="input mono" value={tenant.idNumber} onChange={(e) => setTenant({ ...tenant, idNumber: e.target.value })} />
            </SheetField>
          </SheetGrid>
        ) : (
          <>
            <input className="input" placeholder="Search name or phone…" value={tenantSearch} onChange={(e) => setTenantSearch(e.target.value)} />
            <div className="fs-picks">
              {shownTenants.length === 0 && <span className="fs-picks-empty">No tenants match.</span>}
              {shownTenants.map((t) => (
                <button key={t.id} type="button" className={`fs-pick${tenantId === t.id ? ' on' : ''}`} onClick={() => setTenantId(t.id)}>
                  <span className="fs-pick-av">{t.name.slice(0, 1).toUpperCase()}</span>
                  <span className="fs-pick-main"><b>{t.name}</b><small>{t.phone}</small></span>
                </button>
              ))}
            </div>
            {show('tenant') && <span className="field-error">{show('tenant')}</span>}
          </>
        )}
      </SheetSection>

      <SheetSection id="rent">
        <div className="vf-field">
          <span className="vf-label">Bill rent</span>
          <ChoiceChips value={frequency} onChange={setFrequency} label="Billing frequency" options={(Object.keys(FREQ_LABEL) as BillingFrequency[]).map((f) => ({ value: f, label: FREQ_LABEL[f] }))} />
        </div>
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Rent per {periodWord} <b> *</b></span>{unit?.monthlyRent && <small>Unit default {fmtKes(unit.monthlyRent)} /mo</small>}</span>
          <AmountInput value={rent} onChange={setRent} label="Rent" />
          {show('rent') && <span className="field-error">{show('rent')}</span>}
        </div>
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Due on day</span><small>of each {periodWord}</small></span>
          <div className="fs-due">
            <ChoiceChips value={DUE_DAYS.includes(dueDay) ? dueDay : ''} onChange={setDueDay} label="Due day" options={DUE_DAYS.map((d) => ({ value: d, label: d === '1' ? '1st' : `${d}th` }))} />
            <input className="input mono" inputMode="numeric" aria-label="Custom due day" placeholder="Other" value={DUE_DAYS.includes(dueDay) ? '' : dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
          {show('dueDay') && <span className="field-error">{show('dueDay')}</span>}
        </div>
      </SheetSection>

      <SheetSection id="deposit">
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Security deposit</span><small>Held, not income · refundable</small></span>
          <AmountInput
            value={deposit}
            onChange={setDeposit}
            label="Deposit"
            presets={[
              ...(rentN > 0 ? [1, 2].map((m) => ({ label: `${m}× rent · ${fmtKes(rentN * m)}`, amount: rentN * m })) : []),
              { label: 'No deposit', amount: 0 },
            ]}
          />
        </div>
        {depositN > 0 && (
          <>
            <label className={`fs-check${depositNow ? ' on' : ''}`}>
              <input type="checkbox" checked={depositNow} onChange={(e) => setDepositNow(e.target.checked)} />
              <span><b>I’ve received the {fmtKes(depositN)} deposit</b><small>Recorded as held until it’s refunded or used against the balance.</small></span>
            </label>
            {depositNow && (
              <>
                <div className="fs-methods">
                  {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => {
                    const Icon = METHOD_ICON[m];
                    return (
                      <button key={m} type="button" className={`fs-method${depMethod === m ? ' on' : ''}`} onClick={() => setDepMethod(m)}>
                        <Icon size={18} />{METHOD_LABEL[m]}
                      </button>
                    );
                  })}
                </div>
                <SheetField label={depMethod === 'MPESA' ? 'M-Pesa receipt' : 'Reference'} aside="Optional">
                  <input className="input mono" value={depRef} onChange={(e) => setDepRef(e.target.value.toUpperCase())} placeholder={depMethod === 'MPESA' ? 'e.g. QJK7XB2LMN' : ''} />
                </SheetField>
              </>
            )}
          </>
        )}
      </SheetSection>

      <SheetSection id="dates">
        <SheetGrid>
          <SheetField label="Moves in" required>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </SheetField>
          <SheetField label="Lease ends" aside="Optional" error={show('endDate')}>
            <input className="input" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </SheetField>
        </SheetGrid>
        <ChoiceChips
          value={!endDate ? 'rolling' : endDate === termEnd(startDate, 6) ? '6' : endDate === termEnd(startDate, 12) ? '12' : 'custom'}
          onChange={(v) => setEndDate(v === 'rolling' ? '' : v === 'custom' ? endDate : termEnd(startDate, Number(v)))}
          label="Term"
          options={[{ value: 'rolling', label: 'Rolling, no end' }, { value: '6', label: '6 months' }, { value: '12', label: '1 year' }]}
        />
        <label className={`fs-check${existingTenancy ? ' on' : ''}`}>
          <input type="checkbox" checked={existingTenancy} onChange={(e) => setExistingTenancy(e.target.checked)} />
          <span><b>The tenant moved in before using TokenPap</b><small>Only bill from a later date, so months you already collected aren’t charged again.</small></span>
        </label>
        {existingTenancy && (
          <SheetField label="Start billing from" error={show('billFrom')}>
            <input className="input" type="date" value={billFrom} min={startDate} onChange={(e) => setBillFrom(e.target.value)} />
          </SheetField>
        )}
        <SheetField label="Notes" aside="Optional">
          <textarea className="eoc-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Pays by standing order" />
        </SheetField>
        <SheetNote>
          Rent is charged per calendar {periodWord}, due on day {Number(dueDay) || '–'}. A tenancy that starts or ends mid-{periodWord} is charged for the days used.
        </SheetNote>
      </SheetSection>
    </FormSheet>
  );
}
