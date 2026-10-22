import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Eye, Home, MapPin, Minus, Plus, Trash2, Wallet } from 'lucide-react';
import { applyPaymentAccount, assignUnitMeter, createUnit, createUnitsBulk, deleteUnit, getPropertyUnits, listProperties, updateUnit } from '@/api/properties';
import { errorMessage } from '@/api/client';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { confirmDialog, notify } from '@/lib/alert';
import { humanize } from '@/lib/format';
import { ChoiceChips, ChoiceTiles, FormSheet, SheetField, SheetGrid, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, SearchInput } from '@/components/shared/ui';
import { fmtKes } from '@/lib/format';
import type { PaymentSource, PropertyUnit, UnitOccupancy } from '@/types/api';
import LeaseFormModal from '@/pages/rentals/LeaseFormModal';
import { PaymentAccountFields, PaymentChip, emptyDraft, paymentError, toPayment, type PaymentDraft } from './paymentAccount';
import UnitSheet, { OCCUPANCY } from './UnitSheet';

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

/** One payment account copied onto every unit (or only units that don't have one yet). */
function ApplyPaymentModal({ propertyId, propertyName, missing, total, sources, onClose }: { propertyId: string; propertyName: string; missing: number; total: number; sources: PaymentSource[]; onClose: () => void }) {
  const refresh = useRefresh(propertyId);
  const [draft, setDraft] = useState<PaymentDraft>(emptyDraft());
  const [scope, setScope] = useState<'all' | 'missing'>(missing > 0 && missing < total ? 'missing' : 'all');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = paymentError(draft, sources);
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
        <PaymentAccountFields value={draft} onChange={setDraft} sources={sources} errors={tried ? problem : null} />
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

type Filter = 'ALL' | UnitOccupancy | 'NO_PAYMENT';
const ORDER: UnitOccupancy[] = ['OCCUPIED', 'VACANT', 'RESERVED', 'MAINTENANCE'];

/** Who to show on a unit: the lease tenant, else linked tenants / customers. */
function occupantOf(u: PropertyUnit): { name: string; detail: string } | null {
  if (u.activeLease) return { name: u.activeLease.tenantName, detail: `Lease ${u.activeLease.code}` };
  const people = [...u.tenants, ...u.customers];
  if (!people.length) return null;
  const kind = u.tenants.length ? 'Tenant' : 'Customer';
  return { name: people[0]!.name, detail: people.length > 1 ? `+${people.length - 1} more` : kind };
}

const money = (n: number | null) => (n === null ? '' : String(n));

/** Rent / deposit input that saves when you leave it. */
function MoneyCell({ unit, field, onSaved, disabled }: { unit: PropertyUnit; field: 'monthlyRent' | 'depositAmount'; onSaved: () => void; disabled: boolean }) {
  const value = unit[field];
  const [draft, setDraft] = useState(money(value));
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => setDraft(money(value)), [value]);
  const shown = focused || draft === '' || Number.isNaN(Number(draft)) ? draft : Number(draft).toLocaleString('en-KE', { maximumFractionDigits: 2 });

  const commit = async () => {
    const next = draft.trim() === '' ? null : Number(draft);
    if (next === value || (next !== null && Number.isNaN(next))) return;
    setSaving(true);
    try {
      await updateUnit(unit.id, { [field]: next });
      onSaved();
    } catch (err) {
      notify('error', 'Could not save', errorMessage(err));
      setDraft(money(value));
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="ut-money">
      <span>KES</span>
      <input
        className="mono"
        style={{ opacity: saving ? 0.6 : 1 }}
        inputMode="decimal"
        placeholder="-"
        disabled={disabled}
        aria-label={`${field === 'monthlyRent' ? 'Monthly rent' : 'Deposit'} for ${unit.name}`}
        value={shown}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={() => { setFocused(false); void commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </span>
  );
}

function UnitsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useLandlordAccess();
  const manage = can('properties.manage');
  const [dialog, setDialog] = useState<'add' | 'payment' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [leaseFor, setLeaseFor] = useState<string | null>(null);
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
  const property = data?.property;
  const counts = useMemo(() => {
    const c: Record<UnitOccupancy, number> = { OCCUPIED: 0, VACANT: 0, RESERVED: 0, MAINTENANCE: 0 };
    for (const u of units) c[u.occupancy]++;
    return c;
  }, [units]);
  const withPayment = units.filter((u) => u.payment).length;
  const missing = units.length - withPayment;
  const rentRoll = units.reduce((sum, u) => sum + (u.activeLease || u.occupancy === 'OCCUPIED' ? u.monthlyRent ?? 0 : 0), 0);
  const potential = units.reduce((sum, u) => sum + (u.monthlyRent ?? 0), 0);
  const occupancyRate = units.length ? Math.round((counts.OCCUPIED / units.length) * 100) : 0;

  const shown = units.filter((u) => {
    if (filter === 'NO_PAYMENT' && u.payment) return false;
    if (filter !== 'ALL' && filter !== 'NO_PAYMENT' && u.occupancy !== filter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const people = [u.activeLease?.tenantName, ...u.tenants.map((t) => t.name), ...u.customers.map((c) => c.name)].filter(Boolean).join(' ').toLowerCase();
    return u.name.toLowerCase().includes(q) || (u.unitNumber ?? '').toLowerCase().includes(q) || people.includes(q) || (u.meterNumber ?? '').includes(q);
  });
  const unitsByMeter = new Map(units.filter((u) => u.meterId).map((u) => [u.meterId!, u.name]));
  const nextNumber = units.reduce((max, u) => Math.max(max, Number.parseInt(u.unitNumber ?? '', 10) || 0), 0) + 1;
  const viewingUnit = units.find((u) => u.id === viewing);

  const askDelete = async (u: PropertyUnit) => {
    if (await confirmDialog({ title: 'Delete this unit?', subject: { name: u.name, detail: property ? `${property.name} · ${units.length - 1} units after` : undefined, icon: 'door' }, removes: ['The unit and its rent and payment settings'], keeps: u.meterNumber ? [`Meter ${u.meterNumber} (unlinked)`] : undefined, irreversible: true, confirmLabel: 'Delete unit', danger: true })) remove.mutate(u.id);
  };

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

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Properties"
        title="Units"
        subtitle="See who is in each unit at a glance. Open a unit to change its status, occupants, rent, payment account or meter."
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
          <section className="card ux-summary" aria-label={`${property.name} summary`}>
            <div className="ux-id">
              <span className="ux-mark"><Home size={20} strokeWidth={1.75} /></span>
              <div style={{ minWidth: 0 }}>
                <h3>{property.name}</h3>
                <p>
                  <span>{humanize(property.propertyType)}</span>
                  <span className="ux-sep" aria-hidden="true" />
                  <span className="ux-addr"><MapPin size={13} strokeWidth={1.75} /> {[property.location, property.ward?.name, property.county?.name].filter(Boolean).join(', ')}</span>
                </p>
              </div>
            </div>

            <dl className="ux-kpis">
              <div>
                <dt>Occupancy</dt>
                <dd><b>{occupancyRate}%</b><span className="ux-unit">{counts.OCCUPIED} of {units.length} units</span></dd>
                <span className="ux-track" aria-hidden="true"><i style={{ width: `${occupancyRate}%` }} /></span>
              </div>
              <div>
                <dt>Rent roll</dt>
                <dd><b>{fmtKes(rentRoll)}</b><span className="ux-unit">per month</span></dd>
                <span className="ux-foot">{potential > rentRoll ? <>{fmtKes(potential - rentRoll)} more if fully let</> : potential > 0 ? 'Fully let' : 'Set unit rents to see potential'}</span>
              </div>
              <div>
                <dt>Payment accounts</dt>
                <dd><b>{withPayment}</b><span className="ux-unit">of {units.length} units</span></dd>
                {manage && missing > 0 ? (
                  <button type="button" className="ux-action" onClick={() => setDialog('payment')}>Set up {missing === units.length ? 'for all units' : `${missing} remaining`} <span aria-hidden="true">→</span></button>
                ) : <span className="ux-foot">{missing ? `${missing} not set` : 'All units ready to collect'}</span>}
              </div>
            </dl>

            <div className="ux-mix" role="img" aria-label={ORDER.map((o) => `${OCCUPANCY[o].label} ${counts[o]}`).join(', ')}>
              <div className="ux-mix-bar">
                {ORDER.map((o) => counts[o] > 0 && <i key={o} className={o} style={{ flexGrow: counts[o] }} />)}
                {units.length === 0 && <i style={{ flexGrow: 1 }} />}
              </div>
              <ul>
                {ORDER.map((o) => <li key={o}><i className={o} />{OCCUPANCY[o].label}<b>{counts[o]}</b></li>)}
              </ul>
            </div>
          </section>

          <div className="card">
            <div className="card-pad un-toolbar">
              <div className="seg">
                {([['ALL', 'All', units.length], ['OCCUPIED', 'Occupied', counts.OCCUPIED], ['VACANT', 'Vacant', counts.VACANT], ['RESERVED', 'Reserved', counts.RESERVED], ['MAINTENANCE', 'Maintenance', counts.MAINTENANCE], ['NO_PAYMENT', 'No account', missing]] as [Filter, string, number][]).map(([f, label, n]) => (
                  <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{label}<span className="ux-count">{n}</span></button>
                ))}
              </div>
              <SearchInput value={search} onChange={setSearch} placeholder="Search unit, person or meter…" />
            </div>

            {units.length === 0 ? (
              <EmptyState icon={<DoorOpen size={28} />} title="No units yet" action={manage ? <button className="btn btn-primary btn-sm" onClick={() => setDialog('add')}>Add units</button> : undefined} />
            ) : shown.length === 0 ? (
              <EmptyState title="No units match" hint="Try another filter or search." />
            ) : (
              <div className="tbl-wrap">
                <table className="tbl un-table ut-table">
                  <thead><tr>{['Unit', 'Status & occupant', 'Rent /mo', 'Deposit', 'Payment account', 'Meter', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {shown.map((u) => {
                      const occ = OCCUPANCY[u.occupancy];
                      const person = occupantOf(u);
                      return (
                        <tr key={u.id} className={u.status === 'INACTIVE' ? 'un-inactive' : undefined}>
                          <td>
                            <button type="button" className="ut-unit" onClick={() => setViewing(u.id)}>
                              <b>{u.name}</b><small>{u.unitNumber ? `No. ${u.unitNumber}` : 'No number'}{u.status === 'INACTIVE' ? ' · Inactive' : ''}</small>
                            </button>
                          </td>
                          <td>
                            <span className="ut-occ">
                              <span className={`ux-status ${u.occupancy}`}><i aria-hidden="true" />{occ.label}</span>
                              {person
                                ? <span className="ut-person"><span className="uc-av">{person.name.slice(0, 1).toUpperCase()}</span><span><b>{person.name}</b><small>{person.detail}</small></span></span>
                                : u.occupancyNote && <small className="ut-note">{u.occupancyNote}</small>}
                            </span>
                          </td>
                          <td><MoneyCell unit={u} field="monthlyRent" onSaved={refresh} disabled={!manage} /></td>
                          <td><MoneyCell unit={u} field="depositAmount" onSaved={refresh} disabled={!manage} /></td>
                          <td>
                            {u.payment ? (
                              <button type="button" className="un-pay-btn" onClick={() => setViewing(u.id)} title="Change payment account"><PaymentChip payment={u.payment} /></button>
                            ) : manage ? (
                              <button type="button" className="ux-set" onClick={() => setViewing(u.id)}><Plus size={13} /> Set account</button>
                            ) : <span className="rn-muted">Not set</span>}
                          </td>
                          <td>
                            <select
                              className="eoc-select un-meter"
                              value={u.meterId ?? ''}
                              disabled={!manage || assign.isPending}
                              onChange={(e) => assign.mutate({ id: u.id, meterId: e.target.value || null })}
                              aria-label={`Meter for ${u.name}`}
                            >
                              <option value="">No meter</option>
                              {data.assignedMeters.map((m) => {
                                const on = unitsByMeter.get(m.id);
                                return <option key={m.id} value={m.id}>{m.meterNumber}{on && on !== u.name ? ` (on ${on})` : ''}</option>;
                              })}
                            </select>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className="ut-actions">
                              <button type="button" className="ux-view" onClick={() => setViewing(u.id)}><Eye size={14} strokeWidth={1.75} /> View</button>
                              {manage && !u.activeLease && <button type="button" className="ux-icon" title="Delete unit" aria-label={`Delete ${u.name}`} onClick={() => askDelete(u)}><Trash2 size={14} strokeWidth={1.75} /></button>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {dialog === 'add' && <AddUnitsModal propertyId={propertyId} nextNumber={nextNumber} onClose={() => setDialog(null)} />}
      {dialog === 'payment' && property && (
        <ApplyPaymentModal propertyId={propertyId} propertyName={property.name} missing={missing} total={units.length} sources={data?.paymentSources ?? []} onClose={() => setDialog(null)} />
      )}
      {viewingUnit && property && data && (
        <UnitSheet
          key={viewingUnit.id}
          unit={viewingUnit}
          propertyId={propertyId}
          propertyName={property.name}
          meters={data.assignedMeters}
          unitsByMeter={unitsByMeter}
          paymentSources={data.paymentSources}
          canManage={manage}
          canPeople={can('tenants.manage')}
          onClose={() => setViewing(null)}
          onCreateLease={() => { setLeaseFor(viewingUnit.id); setViewing(null); }}
        />
      )}
      {leaseFor && <LeaseFormModal presetUnitId={leaseFor} onClose={() => setLeaseFor(null)} onCreated={() => refresh()} />}
    </div>
  );
}

export default UnitsPage;
