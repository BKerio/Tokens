import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, FileSignature, Home, KeyRound, Link2, MessageSquare, Pencil, Phone, ShieldCheck, Trash2, UserPlus, UserRound, Users, Zap } from 'lucide-react';
import {
  createLandlordCustomer, createTenant, deleteLandlordCustomer, deleteTenant, getPropertyUnits, listLandlordCustomers, listProperties, listTenants,
  updateLandlordCustomer, updateTenant,
} from '@/api/properties';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { ChoiceChips, ChoiceTiles, FormSheet, SheetField, SheetGrid, SheetNote, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, SearchInput } from '@/components/shared/ui';
import type { LandlordCustomer, RecordStatus, Tenant } from '@/types/api';
import { OCCUPANCY } from './UnitSheet';

type Kind = 'tenant' | 'customer';
type Editing = { kind: Kind; tenant?: Tenant; customer?: LandlordCustomer } | null;

/** Add / edit a tenant or a customer, optionally linking them to a unit. */
function PersonSheet({ editing, onClose }: { editing: NonNullable<Editing>; onClose: () => void }) {
  const queryClient = useQueryClient();
  const existing = editing.tenant ?? editing.customer;
  const [kind, setKind] = useState<Kind>(editing.kind);
  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [idNumber, setIdNumber] = useState(editing.tenant?.idNumber ?? '');
  const [status, setStatus] = useState<RecordStatus>(existing?.status ?? 'ACTIVE');
  // Portal account: tenants are off until the landlord turns it on; customers default on.
  const hadAccess = editing.tenant?.portalAccess ?? editing.customer?.portalAccess ?? false;
  const [portalAccess, setPortalAccess] = useState<boolean>(existing ? hadAccess : editing.kind === 'customer');
  const [sendInvite, setSendInvite] = useState<boolean>(!existing || !hadAccess);
  const invitedAt = editing.tenant?.portalInvitedAt ?? editing.customer?.portalInvitedAt ?? null;
  const [propertyId, setPropertyId] = useState(editing.tenant?.propertyId ?? editing.customer?.unit?.property.id ?? '');
  const [unitId, setUnitId] = useState(existing?.unitId ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: properties = [] } = useQuery({ queryKey: ['properties', ''], queryFn: () => listProperties() });
  const { data: detail, isFetching: loadingUnits } = useQuery({ queryKey: ['property-units', propertyId], queryFn: () => getPropertyUnits(propertyId), enabled: !!propertyId });
  const units = detail?.units ?? [];
  const unit = units.find((u) => u.id === unitId);

  const problems = {
    name: name.trim().length < 2 ? 'Enter their full name' : null,
    phone: phone.replace(/\D/g, '').length < 9 ? 'Enter a phone number' : null,
    email: email && !/\S+@\S+\.\S+/.test(email) ? 'Enter a valid email' : null,
    property: kind === 'tenant' && !propertyId ? 'Choose the property they rent at' : null,
  };
  const show = (k: keyof typeof problems) => (tried ? problems[k] ?? undefined : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    setBusy(true);
    try {
      const base = { name: name.trim(), phone: phone.trim(), email: email.trim() || null, status, portalAccess, sendInvite: portalAccess && sendInvite };
      let saved: { invited?: boolean };
      if (kind === 'tenant') {
        const data = { ...base, idNumber: idNumber.trim() || null, propertyId, unitId: unitId || null };
        saved = editing.tenant ? await updateTenant(editing.tenant.id, data) : await createTenant(data);
      } else {
        const data = { ...base, unitId: unitId || null };
        saved = editing.customer ? await updateLandlordCustomer(editing.customer.id, data) : await createLandlordCustomer(data);
      }
      for (const key of [['tenant-directory'], ['landlord-customers'], ['property-units']]) queryClient.invalidateQueries({ queryKey: key });
      const detail = [
        unit ? `Linked to ${unit.name}.` : '',
        portalAccess && sendInvite ? (saved.invited ? 'Sign-in instructions sent by SMS.' : 'The welcome SMS could not be sent - they can still sign in with their phone.') : '',
      ].filter(Boolean).join(' ');
      notify(portalAccess && sendInvite && !saved.invited ? 'warning' : 'success', existing ? `${name.trim()} updated` : `${kind === 'tenant' ? 'Tenant' : 'Customer'} added`, detail || undefined);
      onClose();
    } catch (err) {
      notify('error', 'Could not save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      icon={kind === 'tenant' ? UserRound : Zap}
      title={existing ? `Edit ${existing.name}` : kind === 'tenant' ? 'Add a tenant' : 'Add a customer'}
      subtitle={kind === 'tenant'
        ? 'Tenants rent a unit. Link them to the unit they live in; create a lease to start billing rent.'
        : 'Customers buy prepaid tokens. Linked to a unit, they buy for that unit’s meter and sign in with their phone.'}
      steps={[
        { id: 'person', title: 'Person', Icon: UserRound, done: !problems.name && !problems.phone && !problems.email },
        { id: 'unit', title: 'Unit', Icon: Link2, done: !!unitId },
        { id: 'account', title: 'Account', Icon: KeyRound, done: true },
      ]}
      width={700}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitLabel={existing ? 'Save changes' : kind === 'tenant' ? 'Add tenant' : 'Add customer'}
      meta={<><Link2 size={15} /> {unit ? <><b>{unit.name}</b> · {detail?.property.name}</> : <b>Not linked to a unit</b>}</>}
    >
      <SheetSection id="person">
        {!existing && (
          <ChoiceTiles
            value={kind}
            onChange={setKind}
            cols={2}
            label="Type"
            options={[
              { value: 'tenant', label: 'Tenant', hint: 'Rents a unit, pays rent', Icon: UserRound },
              { value: 'customer', label: 'Customer', hint: 'Buys tokens for a meter', Icon: Zap },
            ]}
          />
        )}
        <SheetGrid>
          <SheetField label="Full name" required error={show('name')}><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></SheetField>
          <SheetField label="Phone" required error={show('phone')} hint={kind === 'customer' ? 'They sign in and get tokens by SMS on this number' : undefined}>
            <input className="input" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </SheetField>
          <SheetField label="Email" aside="Optional" error={show('email')}><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></SheetField>
          {kind === 'tenant' && (
            <SheetField label="ID / passport no." aside="Optional"><input className="input mono" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></SheetField>
          )}
        </SheetGrid>
        <div className="vf-field">
          <span className="vf-label">Status</span>
          <ChoiceChips value={status} onChange={setStatus} label="Status" options={[{ value: 'ACTIVE', label: 'Active', tone: 'ok' }, { value: 'INACTIVE', label: 'Inactive', tone: 'warn' }]} />
        </div>
      </SheetSection>

      <SheetSection id="unit">
        <SheetField label="Property" required={kind === 'tenant'} aside={kind === 'customer' ? 'Optional' : undefined} error={show('property')}>
          <select className="eoc-select" value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setUnitId(''); }}>
            <option value="">{kind === 'tenant' ? 'Choose a property…' : 'Not linked'}</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </SheetField>
        {propertyId && (
          <div className="vf-field">
            <span className="vf-label-row"><span className="vf-label">Unit</span><small>{loadingUnits ? 'Loading…' : `${units.length} units`}</small></span>
            <div className="pp-units">
              <button type="button" className={`pp-unit none${!unitId ? ' on' : ''}`} onClick={() => setUnitId('')}>No unit</button>
              {units.map((u) => {
                const occ = OCCUPANCY[u.occupancy];
                return (
                  <button key={u.id} type="button" className={`pp-unit ${u.occupancy}${unitId === u.id ? ' on' : ''}`} onClick={() => setUnitId(u.id)} title={occ.label}>
                    <b>{u.name}</b><small><i /> {occ.label}{kind === 'customer' && u.meterNumber ? ' · meter' : ''}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {kind === 'customer' && unit && (
          unit.meterNumber
            ? <SheetNote>They’ll buy tokens for meter <b className="mono">{unit.meterNumber}</b> on {unit.name}.</SheetNote>
            : <SheetNote tone="warn">{unit.name} has no meter yet. Link one on the Units page so this customer can buy tokens.</SheetNote>
        )}
        {kind === 'tenant' && unit?.activeLease && unit.activeLease.tenantId !== editing.tenant?.id && (
          <SheetNote tone="warn">{unit.name} is let to <b>{unit.activeLease.tenantName}</b>. This tenant will be linked as an additional occupant.</SheetNote>
        )}
      </SheetSection>

      <SheetSection id="account">
        <label className={`fs-check${portalAccess ? ' on' : ''}`}>
          <input type="checkbox" checked={portalAccess} onChange={(e) => setPortalAccess(e.target.checked)} />
          <span>
            <b>Create a {kind === 'tenant' ? 'tenant' : 'customer'} account</b>
            <small>{kind === 'tenant'
              ? 'They can sign in to see their lease, balance, statement and where to pay rent.'
              : 'They can sign in to buy tokens for their meter and see their purchase history.'}</small>
          </span>
        </label>

        {portalAccess && (
          <>
            <div className="pa-card">
              <span className="pa-ico"><ShieldCheck size={18} strokeWidth={1.75} /></span>
              <dl>
                <div><dt>Signs in with</dt><dd className="mono">{phone.trim() || 'their phone number'}</dd></div>
                <div><dt>Verification</dt><dd>6-digit code by SMS</dd></div>
                <div><dt>Login page</dt><dd>{window.location.host}/login → {kind === 'tenant' ? 'Tenant' : 'Customer'}</dd></div>
              </dl>
            </div>
            <label className={`fs-check${sendInvite ? ' on' : ''}`}>
              <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
              <span>
                <b><MessageSquare size={13} style={{ verticalAlign: -2 }} /> {invitedAt ? 'Send the sign-in instructions again' : 'Text them how to sign in'}</b>
                <small>{invitedAt ? `Last sent ${new Date(invitedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` : 'A short SMS from you with the link and how to sign in. No password needed.'}</small>
              </span>
            </label>
          </>
        )}
        {!portalAccess && hadAccess && (
          <SheetNote tone="warn">They will be signed out and won’t be able to sign in again until you turn this back on.</SheetNote>
        )}
      </SheetSection>
    </FormSheet>
  );
}

/** Landlord's people: tenants (rent) and customers (buy tokens), each linkable to a unit. */
export default function PeoplePage() {
  const queryClient = useQueryClient();
  const { can } = useLandlordAccess();
  const manage = can('tenants.manage');
  const [tab, setTab] = useState<Kind>('tenant');
  const [search, setSearch] = useState('');
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [editing, setEditing] = useState<Editing>(null);

  const { data: tenants = [], isLoading: tLoading } = useQuery({ queryKey: ['tenant-directory'], queryFn: listTenants });
  const { data: customers = [], isLoading: cLoading } = useQuery({ queryKey: ['landlord-customers'], queryFn: listLandlordCustomers });

  const removeTenant = useMutation({
    mutationFn: deleteTenant,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tenant-directory'] }); queryClient.invalidateQueries({ queryKey: ['property-units'] }); notify('success', 'Tenant removed'); },
    onError: (err) => notify('error', 'Could not remove tenant', errorMessage(err)),
  });
  const removeCustomer = useMutation({
    mutationFn: deleteLandlordCustomer,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landlord-customers'] }); queryClient.invalidateQueries({ queryKey: ['property-units'] }); notify('success', 'Customer removed'); },
    onError: (err) => notify('error', 'Could not remove customer', errorMessage(err)),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tab === 'tenant'
      ? tenants.map((t) => ({ id: t.id, name: t.name, phone: t.phone, email: t.email, status: t.status, unit: t.unitName ?? null, property: t.propertyName ?? null, lease: t.activeLease ?? null, meter: null as string | null, portal: !!t.portalAccess, invitedAt: t.portalInvitedAt ?? null, tenant: t, customer: undefined as LandlordCustomer | undefined }))
      : customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, status: c.status, unit: c.unit?.name ?? null, property: c.unit?.property.name ?? null, lease: null, meter: c.meter?.meterNumber ?? null, portal: c.portalAccess, invitedAt: c.portalInvitedAt, tenant: undefined as Tenant | undefined, customer: c }));
    return list.filter((r) => {
      if (linkFilter === 'linked' && !r.unit) return false;
      if (linkFilter === 'unlinked' && r.unit) return false;
      return !q || r.name.toLowerCase().includes(q) || r.phone.includes(q) || (r.unit ?? '').toLowerCase().includes(q) || (r.property ?? '').toLowerCase().includes(q);
    });
  }, [tab, tenants, customers, search, linkFilter]);

  const list = tab === 'tenant' ? tenants : customers;
  const linked = tab === 'tenant' ? tenants.filter((t) => t.unitId).length : customers.filter((c) => c.unitId).length;
  const loading = tab === 'tenant' ? tLoading : cLoading;

  const askRemove = async (r: (typeof rows)[number]) => {
    const isTenant = tab === 'tenant';
    const ok = await confirmDialog({
      title: `Remove this ${isTenant ? 'tenant' : 'customer'}?`,
      subject: { name: r.name, detail: r.unit ? `${r.unit} · ${r.property}` : r.phone, icon: 'person' },
      removes: [isTenant ? 'Their tenant record and unit link' : 'Their profile, unit link and phone sign-in'],
      keeps: isTenant ? ['The unit'] : ['Their token purchase history', 'The unit and its meter'],
      irreversible: true,
      confirmLabel: `Remove ${isTenant ? 'tenant' : 'customer'}`,
      danger: true,
    });
    if (ok) (isTenant ? removeTenant : removeCustomer).mutate(r.id);
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Properties"
        title="Tenants & customers"
        subtitle="Everyone who lives in or buys tokens for your units. Link each person to a unit so they show up there."
        actions={manage && (
          <button className="btn btn-primary" onClick={() => setEditing({ kind: tab })}><UserPlus size={16} /> Add {tab === 'tenant' ? 'tenant' : 'customer'}</button>
        )}
      />

      <div className="pp-tabs">
        <button type="button" className={`pp-tab${tab === 'tenant' ? ' on' : ''}`} onClick={() => setTab('tenant')}>
          <span className="pp-tab-ico"><UserRound size={18} /></span>
          <span><b>Tenants</b><small>Rent a unit · {tenants.length}</small></span>
        </button>
        <button type="button" className={`pp-tab${tab === 'customer' ? ' on' : ''}`} onClick={() => setTab('customer')}>
          <span className="pp-tab-ico"><Zap size={18} /></span>
          <span><b>Customers</b><small>Buy tokens · {customers.length}</small></span>
        </button>
      </div>

      <div className="card">
        <div className="card-pad un-toolbar">
          <div className="seg">
            {([['all', `All ${list.length}`], ['linked', `Linked ${linked}`], ['unlinked', `Not linked ${list.length - linked}`]] as const).map(([f, label]) => (
              <button key={f} className={linkFilter === f ? 'on' : ''} onClick={() => setLinkFilter(f)}>{label}</button>
            ))}
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone or unit…" />
        </div>

        {loading ? <LoadingBlock /> : rows.length === 0 ? (
          <EmptyState
            icon={tab === 'tenant' ? <Users size={28} /> : <Zap size={28} />}
            title={list.length ? 'No one matches' : tab === 'tenant' ? 'No tenants yet' : 'No customers yet'}
            hint={list.length ? 'Try another filter or search.' : tab === 'tenant' ? 'Add tenants here, or they are created for you when you make a lease.' : 'Add the people who buy tokens for your units’ meters.'}
            action={manage && !list.length ? <button className="btn btn-primary btn-sm" onClick={() => setEditing({ kind: tab })}>Add {tab === 'tenant' ? 'a tenant' : 'a customer'}</button> : undefined}
          />
        ) : (
          <div className="pp-list">
            {rows.map((r) => (
              <div key={r.id} className={`pp-row${r.status === 'INACTIVE' ? ' inactive' : ''}`}>
                <span className={`pp-av ${tab}`}>{r.name.slice(0, 1).toUpperCase()}</span>
                <span className="pp-who">
                  <b>{r.name}{r.status === 'INACTIVE' && <em>Inactive</em>}{r.portal && <em className="pp-portal" title={r.invitedAt ? `Invited ${new Date(r.invitedAt).toLocaleDateString('en-GB')}` : 'Can sign in'}><KeyRound size={10} /> Can sign in</em>}</b>
                  <small><Phone size={12} /> {r.phone}{r.email ? ` · ${r.email}` : ''}</small>
                </span>
                <span className="pp-where">
                  {r.unit ? (
                    <><DoorOpen size={14} /><span><b>{r.unit}</b><small><Home size={11} /> {r.property}</small></span></>
                  ) : (
                    <span className="pp-unlinked">{tab === 'tenant' && r.property ? `${r.property} · no unit` : 'Not linked to a unit'}</span>
                  )}
                </span>
                <span className="pp-tags">
                  {r.lease && <Link to={`/landlord/leases?lease=${r.lease.id}`} className="pp-tag lease"><FileSignature size={12} /> {r.lease.code}</Link>}
                  {r.meter && <span className="pp-tag meter"><Zap size={12} /> {r.meter}</span>}
                  {tab === 'customer' && r.unit && !r.meter && <span className="pp-tag warn">No meter on unit</span>}
                </span>
                {manage && (
                  <span className="pp-actions">
                    <button className="uc-view" onClick={() => setEditing({ kind: tab, tenant: r.tenant, customer: r.customer })}><Pencil size={13} /> Edit</button>
                    {!r.lease && <button className="icon-btn" title="Remove" onClick={() => askRemove(r)}><Trash2 size={14} /></button>}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <PersonSheet key={`${editing.kind}-${editing.tenant?.id ?? editing.customer?.id ?? 'new'}`} editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
