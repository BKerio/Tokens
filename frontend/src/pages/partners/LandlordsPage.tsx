import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Gauge, Home, KeyRound, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { createLandlord, deleteLandlord, getLandlordMeters, listLandlords, setLandlordMeters, updateLandlord, type LandlordInput } from '@/api/accounts';
import { listMeters } from '@/api/meters';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { statusPill } from '@/lib/format';
import { ChoiceChips, FormSheet, SheetField, SheetGrid, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput } from '@/components/shared/ui';
import type { Landlord } from '@/types/api';

const schema = z.object({
  name: z.string().trim().min(2, 'Required'),
  email: z.string().trim().email('Invalid email'),
  username: z.string().trim().min(3, 'At least 3 characters'),
  password: z.string(),
  phone: z.string().trim().min(9, 'Required'),
  paymentAccount: z.string().trim().min(1, 'Required'),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
type LandlordForm = z.infer<typeof schema>;

function LandlordModal({ landlord, onClose }: { landlord?: Landlord; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<LandlordForm>({
    resolver: zodResolver(
      schema.refine((d) => (landlord ? !d.password || d.password.length >= 8 : d.password.length >= 8), { message: 'At least 8 characters', path: ['password'] }),
    ),
    defaultValues: landlord
      ? {
          name: landlord.fullName, email: landlord.user.email, username: landlord.user.username, password: '', phone: landlord.phone,
          paymentAccount: landlord.paymentAccount, status: landlord.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        }
      : { password: '' },
  });

  const onSubmit = async (form: LandlordForm) => {
    const clean = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')) as Partial<LandlordInput>;
    try {
      if (landlord) await updateLandlord(landlord.id, clean);
      else await createLandlord(clean as LandlordInput);
      queryClient.invalidateQueries({ queryKey: ['landlords'] });
      notify('success', landlord ? 'Landlord updated' : 'Landlord registered');
      onClose();
    } catch (err) {
      notify('error', 'Could not save landlord', errorMessage(err));
    }
  };

  const v = watch();
  return (
    <FormSheet
      icon={Home}
      title={landlord ? `Edit ${landlord.fullName}` : 'Register a landlord'}
      subtitle={landlord ? 'Update the landlord’s details, sign-in or status.' : 'Landlords manage properties, units, leases and rent, and the meters assigned to them.'}
      steps={[
        { id: 'person', title: 'Landlord', Icon: UserRound, done: (v.name ?? '').trim().length >= 2 && (v.phone ?? '').trim().length >= 9 && !!(v.paymentAccount ?? '').trim() },
        { id: 'login', title: 'Sign-in', Icon: KeyRound, done: !!(v.email ?? '').trim() && (v.username ?? '').trim().length >= 3 && (!!landlord || (v.password ?? '').length >= 8) },
      ]}
      width={680}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
      busy={isSubmitting}
      submitLabel={landlord ? 'Save changes' : 'Register landlord'}
      meta={<><Home size={15} /> <b>{(v.name ?? '').trim() || 'New landlord'}</b></>}
    >
      <SheetSection id="person">
        <SheetGrid>
          <SheetField label="Full name" required error={errors.name?.message}><input className="input" autoFocus {...register('name')} /></SheetField>
          <SheetField label="Phone" required error={errors.phone?.message}><input className="input" inputMode="tel" placeholder="07XX XXX XXX" {...register('phone')} /></SheetField>
          <SheetField label="Payment account" required span hint="M-Pesa number, bank account or paybill where their money is settled" error={errors.paymentAccount?.message}>
            <input className="input mono" {...register('paymentAccount')} />
          </SheetField>
        </SheetGrid>
        {landlord && (
          <div className="vf-field">
            <span className="vf-label">Status</span>
            <ChoiceChips value={v.status ?? 'ACTIVE'} onChange={(s) => setValue('status', s)} label="Status" options={[{ value: 'ACTIVE', label: 'Active', tone: 'ok' }, { value: 'SUSPENDED', label: 'Suspended', tone: 'warn' }]} />
          </div>
        )}
      </SheetSection>
      <SheetSection id="login">
        <SheetGrid>
          <SheetField label="Email" required span error={errors.email?.message}><input className="input" type="email" {...register('email')} /></SheetField>
          <SheetField label="Username" required error={errors.username?.message}><input className="input" {...register('username')} /></SheetField>
          <SheetField label={landlord ? 'New password' : 'Password'} required={!landlord} aside={landlord ? 'Leave blank to keep' : undefined} error={errors.password?.message}>
            <input className="input" type="password" autoComplete="new-password" {...register('password')} />
          </SheetField>
        </SheetGrid>
      </SheetSection>
    </FormSheet>
  );
}

/** Pick which meters belong to a landlord (meters already owned by another landlord are shown as taken). */
function MetersModal({ landlord, onClose }: { landlord: Landlord; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const { data: all, isLoading } = useQuery({ queryKey: ['meters', 'all'], queryFn: () => listMeters({ page: 1, limit: 1000 }) });
  const { data: current } = useQuery({ queryKey: ['landlord-meters', landlord.id], queryFn: () => getLandlordMeters(landlord.id) });
  const chosen = selected ?? new Set((current ?? []).map((m) => m.id));

  const save = useMutation({
    mutationFn: () => setLandlordMeters(landlord.id, Array.from(chosen)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landlords'] });
      queryClient.invalidateQueries({ queryKey: ['meters'] });
      notify('success', 'Meter assignments saved');
      onClose();
    },
    onError: (err) => notify('error', 'Could not save', errorMessage(err)),
  });

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const meters = (all?.data ?? []).filter((m) => m.meterNumber.toLowerCase().includes(filter.toLowerCase()));

  return (
    <FormSheet
      icon={Gauge}
      title={`Meters for ${landlord.fullName}`}
      subtitle="Choose which meters belong to this landlord. They can then link each one to a unit."
      width={620}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      busy={save.isPending}
      submitLabel={`Save ${chosen.size} meter${chosen.size === 1 ? '' : 's'}`}
      meta={<><Gauge size={15} /> <b>{chosen.size}</b> selected of {all?.data.length ?? 0}</>}
    >
      <SheetSection id="meters" title="Meters" Icon={Gauge}>
        <input className="input mono" placeholder="Filter by meter number" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="fs-meter-list scroll-thin">
          {isLoading ? <LoadingBlock height={160} /> : meters.length === 0 ? <span className="fs-picks-empty">No meters.</span> : meters.map((m) => {
            const takenBy = m.landlordId && m.landlordId !== landlord.id ? m.landlord?.fullName : null;
            return (
              <label key={m.id} className={`fs-meter${chosen.has(m.id) ? ' on' : ''}${takenBy ? ' taken' : ''}`}>
                <input type="checkbox" checked={chosen.has(m.id)} onChange={() => toggle(m.id)} />
                <span className="mono">{m.meterNumber}</span>
                {m.vendor && <small>{m.vendor.businessName}</small>}
                {takenBy && <em>with {takenBy}</em>}
              </label>
            );
          })}
        </div>
      </SheetSection>
    </FormSheet>
  );
}

function LandlordsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Landlord | 'new' | null>(null);
  const [metersFor, setMetersFor] = useState<Landlord | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['landlords', page, search],
    queryFn: () => listLandlords({ page, limit: 20, search: search || undefined }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: deleteLandlord,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landlords'] });
      notify('success', 'Landlord removed');
    },
    onError: (err) => notify('error', 'Delete failed', errorMessage(err)),
  });

  const onDelete = async (l: Landlord) => {
    if (await confirmDialog({ title: 'Remove this landlord?', subject: { name: l.fullName, detail: l.user.email, icon: 'person' }, removes: ['Their sign-in', 'Their properties, units and tenants'], keeps: ['Their meters (unassigned)', 'Token sales history'], irreversible: true, typeToConfirm: l.fullName, confirmLabel: 'Remove landlord', danger: true })) {
      remove.mutate(l.id);
    }
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Partners"
        title="Landlords"
        subtitle="Property owners who manage meters across their units."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Register landlord</button>}
      />
      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, phone, email…" />
        </div>
        {isLoading ? <LoadingBlock /> : !data?.data.length ? (
          <EmptyState icon={<Home size={28} />} title="No landlords yet" />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{['Name', 'Contact', 'Payment account', 'Properties', 'Meters', 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {data.data.map((l) => (
                  <tr key={l.id}>
                    <td className="strong">{l.fullName}</td>
                    <td>{l.phone}<br /><span className="text-xs" style={{ color: 'var(--muted)' }}>{l.user.email}</span></td>
                    <td className="mono">{l.paymentAccount}</td>
                    <td>{l._count.properties}</td>
                    <td>{l._count.meters}</td>
                    <td><span className={statusPill(l.status)}>{l.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Assign meters" onClick={() => setMetersFor(l)}><Gauge size={14} /></button>
                      <button className="icon-btn" title="Edit" onClick={() => setEditing(l)}><Pencil size={14} /></button>
                      <button className="icon-btn" title="Remove" onClick={() => onDelete(l)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      {editing && <LandlordModal landlord={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {metersFor && <MetersModal landlord={metersFor} onClose={() => setMetersFor(null)} />}
    </div>
  );
}

export default LandlordsPage;
