import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, DoorOpen, Home, MapPin, Minus, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { applyPaymentAccount, assignUnitMeter, createUnit, createUnitsBulk, deleteUnit, getPropertyUnits, listProperties, updateUnit } from '@/api/properties';
import { errorMessage } from '@/api/client';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { confirmDialog, notify } from '@/lib/alert';
import { humanize } from '@/lib/format';
import { AmountInput, ChoiceChips, ChoiceTiles, FormSheet, SheetField, SheetGrid, SheetNote, SheetSection, type SheetStep } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, SearchInput } from '@/components/shared/ui';
import { fmtKes } from '@/lib/format';
import type { PropertyUnit, RecordStatus } from '@/types/api';
import { PaymentAccountFields, PaymentChip, emptyDraft, paymentError, toPayment, type PaymentDraft } from './paymentAccount';

const money = (n: number | null) => (n === null ? '' : String(n));
const parseMoney = (v: string) => (v.trim() === '' ? null : Number(v));

function useRefresh(propertyId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['property-units', propertyId] });
    queryClient.invalidateQueries({ queryKey: ['properties'] });
    queryClient.invalidateQueries({ queryKey: ['vacant-units'] });
    queryClient.invalidateQueries({ queryKey: ['landlord-dashboard'] });
  };
}

/** Add one named unit, or several numbered on from the property's last unit. */
function AddUnitsModal({ propertyId, nextNumber, onClose }: { propertyId: string; nextNumber: number; onClose: () => void }) {
  const refresh = useRefresh(propertyId);
  const [mode, setMode] = useState<'many' | 'one'>('many');
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('Unit');
  const [count, setCount] = useState(5);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const clamp = (n: number) => Math.min(200, Math.max(1, Math.round(n) || 1));
  const label = prefix.trim() || 'Unit';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (mode === 'one' && !name.trim()) return;
    setBusy(true);
    try {
      if (mode === 'many') {
        const units = await createUnitsBulk(propertyId, { count, namePrefix: label });
        notify('success', `${units.length} units added`);
      } else {
        await createUnit({ propertyId, name: name.trim() });
        notify('success', `${name.trim()} added`);
      }
      refresh();
      onClose();
    } catch (err) {
      notify('error', 'Could not add units', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const preview = Math.min(count, 12);
  return (
    <FormSheet
      icon={DoorOpen}
      title="Add units"
      subtitle="New units start vacant. Set their rent, deposit and payment account afterwards."
      width={600}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitLabel={mode === 'many' ? `Add ${count} unit${count === 1 ? '' : 's'}` : 'Add unit'}
      meta={<><DoorOpen size={15} /> <b>{mode === 'many' ? `${count} new unit${count === 1 ? '' : 's'}` : name.trim() || 'One unit'}</b></>}
    >
      <SheetSection id="units" title="What to add" Icon={Plus}>
        <ChoiceChips value={mode} onChange={setMode} label="Mode" options={[{ value: 'many', label: 'Several numbered units' }, { value: 'one', label: 'One named unit' }]} />
        {mode === 'many' ? (
          <>
            <SheetGrid>
              <SheetField label="How many?" required>
                <div className="pf-stepper">
                  <button type="button" onClick={() => setCount(clamp(count - 1))} disabled={count <= 1} aria-label="One fewer"><Minus size={18} /></button>
                  <input className="mono" inputMode="numeric" aria-label="Number of units" value={count} onChange={(e) => setCount(clamp(Number(e.target.value.replace(/\D/g, '').slice(0, 3))))} />
                  <button type="button" onClick={() => setCount(clamp(count + 1))} disabled={count >= 200} aria-label="One more"><Plus size={18} /></button>
                </div>
              </SheetField>
              <SheetField label="Name prefix" hint="e.g. Unit, Shop, Room, House">
                <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </SheetField>
            </SheetGrid>
            <div className="pf-preview" aria-label="Units that will be created">
              {Array.from({ length: preview }, (_, i) => <span key={i} className="pf-unit"><DoorOpen size={13} /> {label} {nextNumber + i}</span>)}
              {count > preview && <span className="pf-unit more">+{count - preview} more</span>}
            </div>
          </>
        ) : (
          <SheetField label="Unit name" required error={tried && !name.trim() ? 'Enter the unit name' : undefined}>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Penthouse, Shop 2, Caretaker’s house" />
          </SheetField>
        )}
      </SheetSection>
    </FormSheet>
  );
}

/** Full editor for one unit: details, rent and deposit, and where its tenant pays. */
function UnitModal({ unit, propertyId, onClose }: { unit: PropertyUnit; propertyId: string; onClose: () => void }) {
  const refresh = useRefresh(propertyId);
  const [name, setName] = useState(unit.name);
  const [unitNumber, setUnitNumber] = useState(unit.unitNumber ?? '');
  const [status, setStatus] = useState<RecordStatus>(unit.status);
  const [rent, setRent] = useState(money(unit.monthlyRent));
  const [deposit, setDeposit] = useState(money(unit.depositAmount));
  const [hasPayment, setHasPayment] = useState(!!unit.payment);
  const [draft, setDraft] = useState<PaymentDraft>(emptyDraft(unit.payment));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const rentN = Number(rent) || 0;
  const depositN = Number(deposit) || 0;
  const payProblem = hasPayment ? paymentError(draft) : null;
  const steps: SheetStep[] = [
    { id: 'details', title: 'Details', Icon: DoorOpen, done: !!name.trim() },
    { id: 'rent', title: 'Rent & deposit', Icon: Coins, done: rentN > 0 },
    { id: 'payment', title: 'Payment account', Icon: Wallet, done: hasPayment && !payProblem },
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!name.trim() || payProblem) return;
    setBusy(true);
    try {
      await updateUnit(unit.id, {
        name: name.trim(),
        unitNumber: unitNumber.trim() || null,
        status,
        monthlyRent: parseMoney(rent),
        depositAmount: parseMoney(deposit),
        payment: hasPayment ? toPayment(draft) : null,
      });
      notify('success', `${name.trim()} saved`);
      refresh();
      onClose();
    } catch (err) {
      notify('error', 'Could not save unit', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const depositPresets = rentN > 0
    ? [1, 2, 3].map((m) => ({ label: `${m}× rent · ${fmtKes(rentN * m)}`, amount: rentN * m }))
    : [];

  return (
    <FormSheet
      icon={DoorOpen}
      title={`Edit ${unit.name}`}
      subtitle={unit.activeLease
        ? <>Let to <b style={{ color: 'var(--ink)' }}>{unit.activeLease.tenantName}</b>. Rent changes here apply to new leases; edit the lease to change what this tenant pays.</>
        : 'Rent and deposit here pre-fill the next lease for this unit.'}
      steps={steps}
      width={680}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitLabel="Save unit"
      meta={<><Coins size={15} /> <b>{rentN ? `${fmtKes(rentN)} /mo` : 'No rent set'}</b>{depositN > 0 && <> · deposit {fmtKes(depositN)}</>}</>}
    >
      <SheetSection id="details">
        <SheetGrid>
          <SheetField label="Unit name" required error={tried && !name.trim() ? 'Enter the unit name' : undefined}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </SheetField>
          <SheetField label="Unit number" aside="Optional">
            <input className="input mono" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} />
          </SheetField>
        </SheetGrid>
        <div className="vf-field">
          <span className="vf-label">Status</span>
          <ChoiceChips value={status} onChange={setStatus} label="Status" options={[{ value: 'ACTIVE', label: 'Active', tone: 'ok' }, { value: 'INACTIVE', label: 'Inactive', tone: 'warn' }]} />
        </div>
      </SheetSection>

      <SheetSection id="rent">
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Monthly rent</span><small>Per month, before any charges</small></span>
          <AmountInput value={rent} onChange={setRent} label="Monthly rent" />
        </div>
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Deposit</span><small>Held as security, refundable</small></span>
          <AmountInput value={deposit} onChange={setDeposit} label="Deposit" presets={depositPresets} />
        </div>
        {rentN > 0 && (
          <SheetNote>
            A new tenant would pay <b>{fmtKes(rentN + depositN)}</b> to move in: first month’s rent {fmtKes(rentN)}{depositN > 0 && <> + deposit {fmtKes(depositN)}</>}.
          </SheetNote>
        )}
      </SheetSection>

      <SheetSection id="payment">
        <label className={`fs-check${hasPayment ? ' on' : ''}`}>
          <input type="checkbox" checked={hasPayment} onChange={(e) => setHasPayment(e.target.checked)} />
          <span><b>Tenants of this unit pay into a specific account</b><small>Shown on statements and receipts so tenants know where to send rent.</small></span>
        </label>
        {hasPayment && <PaymentAccountFields value={draft} onChange={setDraft} errors={tried ? payProblem : null} />}
      </SheetSection>
    </FormSheet>
  );
}

/** One payment account copied onto every unit (or only units that don't have one yet). */
function ApplyPaymentModal({ propertyId, propertyName, missing, total, onClose }: { propertyId: string; propertyName: string; missing: number; total: number; onClose: () => void }) {
  const refresh = useRefresh(propertyId);
  const [draft, setDraft] = useState<PaymentDraft>(emptyDraft());
  const [scope, setScope] = useState<'all' | 'missing'>(missing > 0 && missing < total ? 'missing' : 'all');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = paymentError(draft);
  const affected = scope === 'missing' ? missing : total;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    setBusy(true);
    try {
      const { updated } = await applyPaymentAccount(propertyId, toPayment(draft), scope === 'missing');
      notify('success', `Payment account set on ${updated} unit${updated === 1 ? '' : 's'}`);
      refresh();
      onClose();
    } catch (err) {
      notify('error', 'Could not save payment account', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      icon={Wallet}
      title="Payment account"
      subtitle={<>Set where tenants of <b style={{ color: 'var(--ink)' }}>{propertyName}</b> pay rent. You can still change any single unit afterwards.</>}
      steps={[
        { id: 'account', title: 'Account', Icon: Wallet, done: !problem },
        { id: 'scope', title: 'Apply to', Icon: DoorOpen, done: affected > 0 },
      ]}
      width={660}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitLabel={`Apply to ${affected} unit${affected === 1 ? '' : 's'}`}
      meta={<><DoorOpen size={15} /> <b>{affected} of {total}</b> units</>}
    >
      <SheetSection id="account">
        <PaymentAccountFields value={draft} onChange={setDraft} errors={tried ? problem : null} />
      </SheetSection>
      <SheetSection id="scope">
        <ChoiceTiles
          value={scope}
          onChange={setScope}
          cols={2}
          label="Apply to"
          options={[
            { value: 'all', label: `All ${total} units`, hint: 'Replaces any account already set', Icon: DoorOpen },
            { value: 'missing', label: `${missing} without an account`, hint: missing ? 'Keeps accounts you’ve already set' : 'Every unit already has one', Icon: Wallet },
          ]}
        />
      </SheetSection>
    </FormSheet>
  );
}

/** Rent / deposit input that saves on blur. */
function MoneyCell({ unit, field, propertyId, disabled }: { unit: PropertyUnit; field: 'monthlyRent' | 'depositAmount'; propertyId: string; disabled: boolean }) {
  const refresh = useRefresh(propertyId);
  const value = unit[field];
  const [draft, setDraft] = useState(money(value));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(money(value)), [value]);

  const commit = async () => {
    const next = parseMoney(draft);
    if (next === value || (next !== null && Number.isNaN(next))) return;
    setSaving(true);
    try {
      await updateUnit(unit.id, { [field]: next });
      refresh();
    } catch (err) {
      notify('error', 'Could not save', errorMessage(err));
      setDraft(money(value));
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      className="input mono un-money"
      style={{ opacity: saving ? 0.6 : 1 }}
      inputMode="decimal"
      placeholder="-"
      disabled={disabled}
      aria-label={`${field === 'monthlyRent' ? 'Monthly rent' : 'Deposit'} for ${unit.name}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

type Filter = 'ALL' | 'VACANT' | 'LET' | 'NO_PAYMENT';

function UnitsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useLandlordAccess();
  const manage = can('properties.manage');
  const [dialog, setDialog] = useState<'add' | 'payment' | PropertyUnit | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');

  const { data: properties = [], isLoading: propsLoading } = useQuery({ queryKey: ['properties', ''], queryFn: () => listProperties() });
  const propertyId = params.get('property') ?? '';
  useEffect(() => {
    if (!propertyId && properties[0]) setParams({ property: properties[0].id }, { replace: true });
  }, [propertyId, properties, setParams]);

  const { data, isLoading } = useQuery({ queryKey: ['property-units', propertyId], queryFn: () => getPropertyUnits(propertyId), enabled: !!propertyId });
  const refresh = useRefresh(propertyId);

  const assign = useMutation({
    mutationFn: ({ id, meterId }: { id: string; meterId: string | null }) => assignUnitMeter(id, meterId),
    onSuccess: () => { refresh(); notify('success', 'Meter link updated'); },
    onError: (err) => notify('error', 'Could not link meter', errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: deleteUnit,
    onSuccess: () => { refresh(); notify('success', 'Unit deleted'); },
    onError: (err) => notify('error', 'Delete failed', errorMessage(err)),
  });

  const units = data?.units ?? [];
  const stats = useMemo(() => ({
    let: units.filter((u) => u.activeLease).length,
    withPayment: units.filter((u) => u.payment).length,
    rentRoll: units.reduce((sum, u) => sum + (u.monthlyRent ?? 0), 0),
  }), [units]);
  const shown = units.filter((u) => {
    if (filter === 'VACANT' && u.activeLease) return false;
    if (filter === 'LET' && !u.activeLease) return false;
    if (filter === 'NO_PAYMENT' && u.payment) return false;
    const q = search.trim().toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || (u.unitNumber ?? '').toLowerCase().includes(q) || (u.activeLease?.tenantName ?? '').toLowerCase().includes(q);
  });
  const linked = new Map(units.filter((u) => u.meterId).map((u) => [u.meterId!, u.name]));
  const nextNumber = units.reduce((max, u) => Math.max(max, Number.parseInt(u.unitNumber ?? '', 10) || 0), 0) + 1;

  if (propsLoading) return <LoadingBlock />;
  if (properties.length === 0) {
    return (
      <div className="col" style={{ gap: 20 }}>
        <PageHeader eyebrow="Properties" title="Units" />
        <div className="card">
          <EmptyState icon={<Home size={28} />} title="Add a property first" hint="Create a property with its number of units under My Properties, then set each unit up here."
            action={<Link className="btn btn-primary btn-sm" to="/landlord/properties">Go to My Properties</Link>} />
        </div>
      </div>
    );
  }

  const property = data?.property;
  const missing = units.length - stats.withPayment;

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Properties"
        title="Units"
        subtitle="Set each unit’s rent, deposit, payment account and meter."
        actions={
          <>
            <select className="eoc-select" value={propertyId} onChange={(e) => setParams({ property: e.target.value })} aria-label="Property">
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {manage && data && <button className="btn btn-ghost" onClick={() => setDialog('payment')}><Wallet size={16} /> Payment account</button>}
            {manage && data && <button className="btn btn-primary" onClick={() => setDialog('add')}><Plus size={16} /> Add units</button>}
          </>
        }
      />

      {isLoading || !data || !property ? <LoadingBlock /> : (
        <>
          <div className="card un-head">
            <div className="un-head-main">
              <span className="un-head-ico"><Home size={22} /></span>
              <div>
                <h3>{property.name}</h3>
                <p>
                  <span className="pill pill-gray">{humanize(property.propertyType)}</span>
                  {property.locationGroup && <span className="pill pill-blue">{property.locationGroup.name}</span>}
                  <span className="un-addr"><MapPin size={13} /> {property.location}</span>
                </p>
              </div>
            </div>
            <div className="un-stats">
              <div><small>Units</small><b>{units.length}</b></div>
              <div><small>Let</small><b>{stats.let}</b></div>
              <div><small>Vacant</small><b>{units.length - stats.let}</b></div>
              <div className={missing ? 'warn' : ''}><small>Payment accounts</small><b>{stats.withPayment}/{units.length}</b></div>
              <div><small>Rent roll /mo</small><b>{stats.rentRoll.toLocaleString('en-KE')}</b></div>
            </div>
          </div>

          {manage && missing > 0 && units.length > 0 && (
            <div className="un-banner">
              <Wallet size={18} />
              <span><b>{missing} unit{missing === 1 ? '' : 's'}</b> {missing === 1 ? 'has' : 'have'} no payment account yet. Tenants won’t know where to pay.</span>
              <button className="btn btn-primary btn-sm" onClick={() => setDialog('payment')}>Set for {missing === units.length ? 'all units' : `${missing} units`}</button>
            </div>
          )}

          <div className="card">
            <div className="card-pad un-toolbar">
              <div className="seg">
                {([['ALL', `All ${units.length}`], ['VACANT', 'Vacant'], ['LET', 'Let'], ['NO_PAYMENT', 'No payment account']] as [Filter, string][]).map(([f, label]) => (
                  <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{label}</button>
                ))}
              </div>
              <SearchInput value={search} onChange={setSearch} placeholder="Search unit or tenant…" />
            </div>
            {units.length === 0 ? (
              <EmptyState icon={<DoorOpen size={28} />} title="No units yet" action={manage ? <button className="btn btn-primary btn-sm" onClick={() => setDialog('add')}>Add units</button> : undefined} />
            ) : shown.length === 0 ? (
              <EmptyState title="No units match" />
            ) : (
              <div className="tbl-wrap">
                <table className="tbl un-table">
                  <thead><tr>{['Unit', 'Occupancy', 'Rent /mo', 'Deposit', 'Payment account', 'Meter', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {shown.map((u) => (
                      <tr key={u.id} className={u.status === 'INACTIVE' ? 'un-inactive' : ''}>
                        <td>
                          <span className="rn-strong">{u.name}</span>
                          <span className="rn-sub">{u.unitNumber ? `No. ${u.unitNumber}` : 'No number'}{u.status === 'INACTIVE' ? ' · Inactive' : ''}</span>
                        </td>
                        <td>
                          {u.activeLease ? (
                            <Link className="un-tenant" to={`/landlord/leases?lease=${u.activeLease.id}`}>
                              <span className="pill pill-green">Let</span>
                              <span><b>{u.activeLease.tenantName}</b><small>{u.activeLease.code}</small></span>
                            </Link>
                          ) : <span className="pill pill-gray">Vacant</span>}
                        </td>
                        <td><MoneyCell unit={u} field="monthlyRent" propertyId={propertyId} disabled={!manage} /></td>
                        <td><MoneyCell unit={u} field="depositAmount" propertyId={propertyId} disabled={!manage} /></td>
                        <td>
                          {u.payment ? (
                            manage ? <button className="un-pay-btn" onClick={() => setDialog(u)} title="Change payment account"><PaymentChip payment={u.payment} /></button> : <PaymentChip payment={u.payment} />
                          ) : manage ? (
                            <button className="un-pay-add" onClick={() => setDialog(u)}><Plus size={14} /> Add account</button>
                          ) : <span className="rn-muted">Not set</span>}
                        </td>
                        <td>
                          <select className="eoc-select un-meter" value={u.meterId ?? ''} disabled={!manage || assign.isPending} onChange={(e) => assign.mutate({ id: u.id, meterId: e.target.value || null })} aria-label={`Meter for ${u.name}`}>
                            <option value="">No meter</option>
                            {data.assignedMeters.map((m) => (
                              <option key={m.id} value={m.id}>{m.meterNumber}{linked.has(m.id) && linked.get(m.id) !== u.name ? ` (on ${linked.get(m.id)})` : ''}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {manage && <button className="icon-btn" title="Edit unit" onClick={() => setDialog(u)}><Pencil size={14} /></button>}
                          {manage && !u.activeLease && (
                            <button className="icon-btn" title="Delete unit" onClick={async () => {
                              if (await confirmDialog({ title: 'Delete this unit?', subject: { name: u.name, detail: property ? `${property.name} · ${units.length - 1} units after` : undefined, icon: 'door' }, removes: ['The unit and its rent and payment settings'], keeps: u.meterNumber ? [`Meter ${u.meterNumber} (unlinked)`] : undefined, irreversible: true, confirmLabel: 'Delete unit', danger: true })) remove.mutate(u.id);
                            }}><Trash2 size={14} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {dialog === 'add' && <AddUnitsModal propertyId={propertyId} nextNumber={nextNumber} onClose={() => setDialog(null)} />}
      {dialog === 'payment' && property && (
        <ApplyPaymentModal propertyId={propertyId} propertyName={property.name} missing={missing} total={units.length} onClose={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && <UnitModal unit={dialog} propertyId={propertyId} onClose={() => setDialog(null)} />}
    </div>
  );
}

export default UnitsPage;
