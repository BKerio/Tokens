import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Coins, DoorOpen, FileSignature, Gauge, Plus, UserPlus, UserRound, Users, Wallet, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react';
import { assignUnitMeter, createLandlordCustomer, createTenant, listLandlordCustomers, listTenants, updateUnit } from '@/api/properties';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { fmtKes } from '@/lib/format';
import AppLoader from '@/components/shared/AppLoader';
import { AmountInput, ChoiceChips, ChoiceTiles, FormSheet, SheetField, SheetGrid, SheetNote, SheetSection, type SheetStep } from '@/components/shared/FormSheet';
import type { MeterStatus, PaymentSource, PersonRef, PropertyUnit, RecordStatus, UnitOccupancy } from '@/types/api';
import { PaymentAccountFields, PaymentChip, emptyDraft, paymentError, toPayment, type PaymentDraft } from './paymentAccount';

export const OCCUPANCY: Record<UnitOccupancy, { label: string; hint: string; Icon: LucideIcon }> = {
  OCCUPIED: { label: 'Occupied', hint: 'Someone lives or works here', Icon: Users },
  VACANT: { label: 'Vacant', hint: 'Ready to let', Icon: DoorOpen },
  RESERVED: { label: 'Reserved', hint: 'Held for an incoming tenant', Icon: CalendarClock },
  MAINTENANCE: { label: 'Under maintenance', hint: 'Not available right now', Icon: Wrench },
};

const money = (n: number | null) => (n === null ? '' : String(n));
const parseMoney = (v: string) => (v.trim() === '' ? null : Number(v));

type PersonKind = 'tenant' | 'customer';

/**
 * Tenants or customers linked to the unit: chips for the current links, a
 * search over the landlord's directory, and a quick "add new" that creates
 * the person and links them in one go.
 */
function PeoplePicker({ kind, linked, onChange, propertyId, unitId, disabled }: {
  kind: PersonKind; linked: PersonRef[]; onChange: (next: PersonRef[]) => void; propertyId: string; unitId: string; disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: tenants = [] } = useQuery({ queryKey: ['tenant-directory'], queryFn: listTenants, enabled: kind === 'tenant' });
  const { data: customers = [] } = useQuery({ queryKey: ['landlord-customers'], queryFn: listLandlordCustomers, enabled: kind === 'customer' });
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const linkedIds = new Set(linked.map((p) => p.id));
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = kind === 'tenant'
      ? tenants.map((t) => ({ id: t.id, name: t.name, phone: t.phone, where: t.unitName ? `${t.unitName} · ${t.propertyName}` : 'Not linked to a unit' }))
      : customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, where: c.unit ? `${c.unit.name} · ${c.unit.property.name}` : 'Not linked to a unit' }));
    return all.filter((p) => !linkedIds.has(p.id) && (!q || p.name.toLowerCase().includes(q) || p.phone.includes(q))).slice(0, 6);
  }, [kind, tenants, customers, search, linked]); // eslint-disable-line react-hooks/exhaustive-deps

  const addNew = async () => {
    if (draft.name.trim().length < 2 || draft.phone.replace(/\D/g, '').length < 9) return notify('warning', 'Enter a name and phone number');
    setBusy(true);
    try {
      const created = kind === 'tenant'
        ? await createTenant({ propertyId, unitId, name: draft.name.trim(), phone: draft.phone.trim() })
        : await createLandlordCustomer({ unitId, name: draft.name.trim(), phone: draft.phone.trim() });
      queryClient.invalidateQueries({ queryKey: [kind === 'tenant' ? 'tenant-directory' : 'landlord-customers'] });
      onChange([...linked, { id: created.id, name: created.name, phone: created.phone }]);
      setDraft({ name: '', phone: '' });
      setAdding(false);
      notify('success', `${created.name} added and linked`);
    } catch (err) {
      notify('error', `Could not add ${kind}`, errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const label = kind === 'tenant' ? 'tenant' : 'customer';
  return (
    <div className="us-people">
      <div className="us-linked">
        {linked.length === 0 && <span className="us-none">No {label}s linked</span>}
        {linked.map((p) => (
          <span key={p.id} className={`us-chip ${kind}`}>
            <span className="us-chip-av">{p.name.slice(0, 1).toUpperCase()}</span>
            <span className="us-chip-text"><b>{p.name}</b><small>{p.phone}</small></span>
            {!disabled && <button type="button" aria-label={`Unlink ${p.name}`} onClick={() => onChange(linked.filter((x) => x.id !== p.id))}><X size={14} /></button>}
          </span>
        ))}
      </div>

      {!disabled && (
        <>
          <div className="us-find">
            <input className="input" placeholder={`Find a ${label} by name or phone…`} value={search} onChange={(e) => setSearch(e.target.value)} />
            <button type="button" className={`us-new${adding ? ' on' : ''}`} onClick={() => setAdding((a) => !a)}><UserPlus size={15} /> New {label}</button>
          </div>
          {adding && (
            <div className="us-add">
              <input className="input" placeholder="Full name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <input className="input" inputMode="tel" placeholder="07XX XXX XXX" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              <button type="button" className="vf-btn vf-btn-primary" style={{ minWidth: 0, height: 42 }} onClick={addNew} disabled={busy}>
                {busy ? <AppLoader size={14} /> : <><Plus size={15} /> Add & link</>}
              </button>
            </div>
          )}
          {(search || options.length > 0) && !adding && (
            <div className="fs-picks">
              {options.length === 0 && <span className="fs-picks-empty">No {label}s match. Use “New {label}” to add one.</span>}
              {options.map((p) => (
                <button key={p.id} type="button" className="fs-pick" onClick={() => { onChange([...linked, { id: p.id, name: p.name, phone: p.phone }]); setSearch(''); }}>
                  <span className="fs-pick-av">{p.name.slice(0, 1).toUpperCase()}</span>
                  <span className="fs-pick-main"><b>{p.name}</b><small>{p.phone} · {p.where}</small></span>
                  <Plus size={16} style={{ color: 'var(--green)' }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** View / edit one unit: status, who lives there, rent, payment account and meter. */
export default function UnitSheet({ unit, propertyId, propertyName, meters, unitsByMeter, paymentSources, canManage, canPeople, onClose, onCreateLease }: {
  unit: PropertyUnit;
  propertyId: string;
  propertyName: string;
  meters: { id: string; meterNumber: string; status: MeterStatus }[];
  /** meterId → name of the unit it's on. */
  unitsByMeter: Map<string, string>;
  /** Payment accounts configured for this landlord. */
  paymentSources: PaymentSource[];
  canManage: boolean;
  canPeople: boolean;
  onClose: () => void;
  onCreateLease: () => void;
}) {
  const queryClient = useQueryClient();
  const lease = unit.activeLease;
  const [name, setName] = useState(unit.name);
  const [unitNumber, setUnitNumber] = useState(unit.unitNumber ?? '');
  const [status, setStatus] = useState<RecordStatus>(unit.status);
  const [occupancy, setOccupancy] = useState<UnitOccupancy>(unit.occupancy);
  const [note, setNote] = useState(unit.occupancyNote ?? '');
  const [tenants, setTenants] = useState<PersonRef[]>(unit.tenants);
  const [customers, setCustomers] = useState<PersonRef[]>(unit.customers);
  const [rent, setRent] = useState(money(unit.monthlyRent));
  const [deposit, setDeposit] = useState(money(unit.depositAmount));
  const [hasPayment, setHasPayment] = useState(!!unit.payment);
  const [draft, setDraft] = useState<PaymentDraft>(emptyDraft(unit.payment));
  const [meterId, setMeterId] = useState(unit.meterId ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const rentN = Number(rent) || 0;
  const depositN = Number(deposit) || 0;
  const payProblem = hasPayment ? paymentError(draft, paymentSources) : null;
  const readOnly = !canManage;

  // Linking the first person to an empty unit marks it occupied.
  const linkPeople = (kind: PersonKind, next: PersonRef[]) => {
    if (kind === 'tenant') setTenants(next); else setCustomers(next);
    const total = (kind === 'tenant' ? next.length : tenants.length) + (kind === 'customer' ? next.length : customers.length);
    if (total > 0 && occupancy === 'VACANT') setOccupancy('OCCUPIED');
  };

  const steps: SheetStep[] = [
    { id: 'status', title: 'Status', Icon: DoorOpen, done: !!name.trim() },
    { id: 'people', title: 'Occupants', Icon: Users, done: !!lease || tenants.length + customers.length > 0 },
    { id: 'rent', title: 'Rent & deposit', Icon: Coins, done: rentN > 0 },
    { id: 'payment', title: 'Payment', Icon: Wallet, done: hasPayment && !payProblem },
    { id: 'meter', title: 'Meter', Icon: Gauge, done: !!meterId },
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
        ...(lease ? {} : { occupancy }),
        occupancyNote: note.trim() || null,
        monthlyRent: parseMoney(rent),
        depositAmount: parseMoney(deposit),
        payment: hasPayment ? toPayment(draft) : null,
        ...(canPeople ? { tenantIds: tenants.map((t) => t.id), customerIds: customers.map((c) => c.id) } : {}),
      });
      if ((meterId || null) !== unit.meterId) await assignUnitMeter(unit.id, meterId || null);
      for (const key of [['property-units', propertyId], ['properties'], ['vacant-units'], ['tenant-directory'], ['landlord-customers'], ['landlord-dashboard']]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      notify('success', `${name.trim()} saved`);
      onClose();
    } catch (err) {
      notify('error', 'Could not save unit', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const occ = OCCUPANCY[lease ? 'OCCUPIED' : occupancy];
  return (
    <FormSheet
      icon={occ.Icon}
      title={unit.name}
      subtitle={<>{propertyName}{unit.unitNumber ? ` · No. ${unit.unitNumber}` : ''} · <b className={`us-occ-text ${lease ? 'OCCUPIED' : occupancy}`}>{occ.label}</b></>}
      steps={steps}
      width={760}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      readOnly={readOnly}
      submitLabel="Save unit"
      meta={<><Coins size={15} /> <b>{rentN ? `${fmtKes(rentN)} /mo` : 'No rent set'}</b>{depositN > 0 && <> · deposit {fmtKes(depositN)}</>} · {tenants.length + customers.length || (lease ? 1 : 0)} occupant{tenants.length + customers.length === 1 ? '' : 's'}</>}
    >
      <SheetSection id="status">
        {lease ? (
          <SheetNote>
            Occupied on lease <b className="mono">{lease.code}</b> by <b>{lease.tenantName}</b>. The status changes back automatically when the lease ends.
          </SheetNote>
        ) : (
          <ChoiceTiles
            value={occupancy}
            onChange={canManage ? setOccupancy : () => {}}
            cols={4}
            label="Occupancy"
            options={(Object.keys(OCCUPANCY) as UnitOccupancy[]).map((o) => ({ value: o, label: OCCUPANCY[o].label, hint: OCCUPANCY[o].hint, Icon: OCCUPANCY[o].Icon }))}
          />
        )}
        <SheetField label="Status note" aside="Optional">
          <input className="input" disabled={readOnly} placeholder={occupancy === 'MAINTENANCE' ? 'e.g. Repainting until 30 Oct' : occupancy === 'RESERVED' ? 'e.g. Held for J. Mwangi from 1 Nov' : 'Anything worth noting about this unit'} value={note} onChange={(e) => setNote(e.target.value)} />
        </SheetField>
        <SheetGrid>
          <SheetField label="Unit name" required error={tried && !name.trim() ? 'Enter the unit name' : undefined}>
            <input className="input" disabled={readOnly} value={name} onChange={(e) => setName(e.target.value)} />
          </SheetField>
          <SheetField label="Unit number" aside="Optional">
            <input className="input mono" disabled={readOnly} value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} />
          </SheetField>
        </SheetGrid>
        <div className="vf-field">
          <span className="vf-label">Record</span>
          <ChoiceChips value={status} onChange={canManage ? setStatus : () => {}} label="Record status" options={[{ value: 'ACTIVE', label: 'Active', tone: 'ok' }, { value: 'INACTIVE', label: 'Inactive (hidden from lettings)', tone: 'warn' }]} />
        </div>
      </SheetSection>

      <SheetSection id="people">
        {lease ? (
          <Link to={`/landlord/leases?lease=${lease.id}`} className="us-lease" onClick={onClose}>
            <span className="us-lease-ico"><FileSignature size={18} /></span>
            <span><b>{lease.tenantName}</b><small>Lease <span className="mono">{lease.code}</span> · {lease.tenantPhone}</small></span>
            <em>Open lease</em>
          </Link>
        ) : canManage && (
          <button type="button" className="us-lease cta" onClick={onCreateLease}>
            <span className="us-lease-ico"><FileSignature size={18} /></span>
            <span><b>Let this unit</b><small>Create a lease to bill rent automatically</small></span>
            <em>New lease</em>
          </button>
        )}

        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label"><UserRound size={13} style={{ verticalAlign: -2 }} /> Tenants</span><small>People who rent the unit</small></span>
          <PeoplePicker kind="tenant" linked={tenants} onChange={(n) => linkPeople('tenant', n)} propertyId={propertyId} unitId={unit.id} disabled={!canPeople || readOnly} />
        </div>
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label"><Zap size={13} style={{ verticalAlign: -2 }} /> Customers</span><small>Buy tokens for this unit’s meter</small></span>
          <PeoplePicker kind="customer" linked={customers} onChange={(n) => linkPeople('customer', n)} propertyId={propertyId} unitId={unit.id} disabled={!canPeople || readOnly} />
          {customers.length > 0 && !meterId && <span className="vf-hint">This unit has no meter yet. Link one below so its customers can buy tokens.</span>}
        </div>
      </SheetSection>

      <SheetSection id="rent">
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Monthly rent</span><small>Pre-fills the next lease</small></span>
          <AmountInput value={rent} onChange={readOnly ? () => {} : setRent} label="Monthly rent" />
        </div>
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Deposit</span><small>Held as security, refundable</small></span>
          <AmountInput value={deposit} onChange={readOnly ? () => {} : setDeposit} label="Deposit" presets={readOnly || rentN <= 0 ? [] : [1, 2, 3].map((m) => ({ label: `${m}× rent · ${fmtKes(rentN * m)}`, amount: rentN * m }))} />
        </div>
        {lease && <span className="vf-hint">This tenant’s rent is set on their lease. Changes here apply to the next lease.</span>}
      </SheetSection>

      <SheetSection id="payment">
        {readOnly ? (
          unit.payment ? <PaymentChip payment={unit.payment} /> : <span className="fs-picks-empty">No payment account set.</span>
        ) : (
          <>
            <label className={`fs-check${hasPayment ? ' on' : ''}`}>
              <input type="checkbox" checked={hasPayment} onChange={(e) => setHasPayment(e.target.checked)} />
              <span><b>Tenants of this unit pay into a specific account</b><small>Shown on statements and receipts so tenants know where to send rent.</small></span>
            </label>
            {hasPayment && <PaymentAccountFields value={draft} onChange={setDraft} sources={paymentSources} errors={tried ? payProblem : null} />}
          </>
        )}
      </SheetSection>

      <SheetSection id="meter">
        <SheetField label="Meter on this unit" hint={meters.length ? 'Meters are assigned to you by TokenPap. One meter per unit.' : 'No meters have been assigned to you yet.'}>
          <select className="eoc-select mono" disabled={readOnly || meters.length === 0} value={meterId} onChange={(e) => setMeterId(e.target.value)}>
            <option value="">No meter</option>
            {meters.map((m) => {
              const on = unitsByMeter.get(m.id);
              return <option key={m.id} value={m.id}>{m.meterNumber}{on && on !== unit.name ? ` (on ${on}, will move)` : ''}</option>;
            })}
          </select>
        </SheetField>
      </SheetSection>
    </FormSheet>
  );
}
