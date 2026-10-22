import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Gauge, MapPin, Pencil, Plus, Trash2, UserRound, Users, Zap } from 'lucide-react';
import {
  createCustomer, deleteCustomer, listConstituencies, listCounties, listCustomers, listMeters, listWards, updateCustomer, type CustomerInput,
} from '@/api/meters';
import { listVendors } from '@/api/accounts';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { statusPill } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import { ChoiceChips, FormSheet, SheetField, SheetGrid, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput } from '@/components/shared/ui';
import { ADMIN_ROLES, type Customer } from '@/types/api';

const schema = z.object({
  name: z.string().trim().min(2, 'Required'),
  phone: z.string().trim().min(9, 'Required'),
  email: z.union([z.string().trim().email('Invalid email'), z.literal('')]).optional(),
  address: z.string().trim().optional(),
  meterId: z.string().min(1, 'Select a meter'),
  vendorId: z.string().optional(),
  countyId: z.string().optional(),
  constituencyId: z.string().optional(),
  wardId: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
type CustomerForm = z.infer<typeof schema>;

function CustomerModal({ customer, isAdmin, onClose }: { customer?: Customer; isAdmin: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<CustomerForm>({
    resolver: zodResolver(isAdmin ? schema.refine((d) => !!d.vendorId, { message: 'Select a vendor', path: ['vendorId'] }) : schema),
    defaultValues: {
      name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', address: customer?.address ?? '',
      meterId: customer?.meterId ?? '', vendorId: customer?.vendorId ?? '', status: customer?.status ?? 'ACTIVE',
      countyId: customer?.countyId ? String(customer.countyId) : '', constituencyId: customer?.constituencyId ? String(customer.constituencyId) : '',
      wardId: customer?.wardId ? String(customer.wardId) : '',
    },
  });
  const vendorId = watch('vendorId');
  const countyId = Number(watch('countyId')) || 0;
  const constituencyId = Number(watch('constituencyId')) || 0;

  const { data: vendors } = useQuery({ queryKey: ['vendors', 'options'], queryFn: () => listVendors({ page: 1, limit: 200 }), enabled: isAdmin });
  // Admins pick from the chosen vendor's meters; vendors see only their own (API-scoped).
  const { data: meters } = useQuery({
    queryKey: ['meters', 'options', isAdmin ? vendorId : 'mine'],
    queryFn: () => listMeters({ page: 1, limit: 1000, vendorId: isAdmin ? vendorId || undefined : undefined }),
    enabled: !isAdmin || !!vendorId,
  });
  const { data: counties = [] } = useQuery({ queryKey: ['counties'], queryFn: listCounties, staleTime: Infinity });
  const { data: constituencies = [] } = useQuery({ queryKey: ['constituencies', countyId], queryFn: () => listConstituencies(countyId), enabled: !!countyId, staleTime: Infinity });
  const { data: wards = [] } = useQuery({ queryKey: ['wards', constituencyId], queryFn: () => listWards(constituencyId), enabled: !!constituencyId, staleTime: Infinity });

  const onSubmit = async (f: CustomerForm) => {
    const payload: CustomerInput = {
      name: f.name, phone: f.phone, email: f.email || null, address: f.address || null, meterId: f.meterId, status: f.status,
      vendorId: isAdmin ? f.vendorId : undefined,
      countyId: f.countyId ? Number(f.countyId) : null,
      constituencyId: f.constituencyId ? Number(f.constituencyId) : null,
      wardId: f.wardId ? Number(f.wardId) : null,
    };
    try {
      if (customer) await updateCustomer(customer.id, payload);
      else await createCustomer(payload);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      notify('success', customer ? 'Customer updated' : 'Customer added', customer ? undefined : 'They can now sign in with a code sent to their phone.');
      onClose();
    } catch (err) {
      notify('error', 'Could not save customer', errorMessage(err));
    }
  };

  const v = watch();
  const meterNumber = meters?.data.find((m) => m.id === v.meterId)?.meterNumber;
  return (
    <FormSheet
      icon={UserRound}
      title={customer ? `Edit ${customer.name}` : 'New customer'}
      subtitle={customer ? 'Update the customer’s details, meter or location.' : 'Customers buy tokens for their meter and sign in with a code sent to their phone.'}
      steps={[
        { id: 'person', title: 'Customer', Icon: UserRound, done: (v.name ?? '').trim().length >= 2 && (v.phone ?? '').trim().length >= 9 },
        { id: 'meter', title: 'Meter', Icon: Gauge, done: !!v.meterId },
        { id: 'where', title: 'Location', Icon: MapPin, done: !!v.countyId },
      ]}
      width={720}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
      busy={isSubmitting}
      submitLabel={customer ? 'Save changes' : 'Add customer'}
      meta={<><Gauge size={15} /> <b>{meterNumber ?? 'No meter yet'}</b></>}
    >
      <SheetSection id="person">
        <SheetGrid>
          <SheetField label="Full name" required error={errors.name?.message}><input className="input" autoFocus {...register('name')} /></SheetField>
          <SheetField label="Phone" required hint="Used for SMS tokens and sign-in codes" error={errors.phone?.message}><input className="input" inputMode="tel" placeholder="07XX XXX XXX" {...register('phone')} /></SheetField>
          <SheetField label="Email" aside="Optional" error={errors.email?.message}><input className="input" type="email" {...register('email')} /></SheetField>
          <div className="vf-field">
            <span className="vf-label">Status</span>
            <ChoiceChips value={v.status} onChange={(s) => setValue('status', s)} label="Status" options={[{ value: 'ACTIVE', label: 'Active', tone: 'ok' }, { value: 'INACTIVE', label: 'Inactive', tone: 'warn' }]} />
          </div>
        </SheetGrid>
      </SheetSection>

      <SheetSection id="meter">
        <SheetGrid>
          {isAdmin && (
            <SheetField label="Vendor" required error={errors.vendorId?.message}>
              <select className="eoc-select" {...register('vendorId', { onChange: () => setValue('meterId', '') })}>
                <option value="">Select vendor…</option>
                {vendors?.data.map((x) => <option key={x.id} value={x.id}>{x.businessName}</option>)}
              </select>
            </SheetField>
          )}
          <SheetField label="Meter" required error={errors.meterId?.message}>
            <select className="eoc-select mono" {...register('meterId')} disabled={isAdmin && !vendorId}>
              <option value="">{isAdmin && !vendorId ? 'Pick a vendor first' : 'Select meter…'}</option>
              {meters?.data.map((m) => <option key={m.id} value={m.id}>{m.meterNumber}</option>)}
            </select>
          </SheetField>
        </SheetGrid>
      </SheetSection>

      <SheetSection id="where">
        <SheetGrid cols={3}>
          <SheetField label="County">
            <select className="eoc-select" {...register('countyId', { onChange: () => { setValue('constituencyId', ''); setValue('wardId', ''); } })}>
              <option value="">Select…</option>
              {counties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </SheetField>
          <SheetField label="Constituency">
            <select className="eoc-select" disabled={!countyId} {...register('constituencyId', { onChange: () => setValue('wardId', '') })}>
              <option value="">{countyId ? 'Select…' : 'County first'}</option>
              {constituencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </SheetField>
          <SheetField label="Ward">
            <select className="eoc-select" disabled={!constituencyId} {...register('wardId')}>
              <option value="">{constituencyId ? 'Select…' : 'Constituency first'}</option>
              {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </SheetField>
        </SheetGrid>
        <SheetField label="Address" aside="Optional"><input className="input" placeholder="e.g. House 14, Kahawa West" {...register('address')} /></SheetField>
      </SheetSection>
    </FormSheet>
  );
}

function CustomersPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = !!role && ADMIN_ROLES.includes(role);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', page, search],
    queryFn: () => listCustomers({ page, limit: 20, search: search || undefined }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      notify('success', 'Customer deleted');
    },
    onError: (err) => notify('error', 'Delete failed', errorMessage(err)),
  });

  const onDelete = async (c: Customer) => {
    if (await confirmDialog({ title: 'Delete customer', text: `Delete ${c.name}? Their purchase history is kept.`, confirmLabel: 'Delete', danger: true })) remove.mutate(c.id);
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="People"
        title="Customers"
        subtitle={isAdmin ? 'End consumers across every vendor.' : 'Customers using your meters.'}
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> New customer</button>}
      />
      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, phone, email, meter…" />
        </div>
        {isLoading ? <LoadingBlock /> : !data?.data.length ? (
          <EmptyState icon={<Users size={28} />} title="No customers yet" />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{['Name', 'Phone', 'Meter', ...(isAdmin ? ['Vendor'] : []), 'Location', 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id}>
                    <td className="strong">{c.name}<br /><span className="text-xs" style={{ color: 'var(--muted)' }}>{c.email ?? ''}</span></td>
                    <td>{c.phone}</td>
                    <td className="mono">{c.meter?.meterNumber ?? '-'}</td>
                    {isAdmin && <td>{c.vendor?.businessName ?? '-'}</td>}
                    <td>{[c.ward?.name, c.county?.name].filter(Boolean).join(', ') || c.address || '-'}</td>
                    <td><span className={statusPill(c.status)}>{c.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.meter && <button className="icon-btn" title="Vend token" onClick={() => navigate(`/tokens?q=${encodeURIComponent(c.meter!.meterNumber)}`)}><Zap size={14} /></button>}
                      <button className="icon-btn" title="Edit" onClick={() => setEditing(c)}><Pencil size={14} /></button>
                      <button className="icon-btn" title="Delete" onClick={() => onDelete(c)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      {editing && <CustomerModal customer={editing === 'new' ? undefined : editing} isAdmin={isAdmin} onClose={() => setEditing(null)} />}
    </div>
  );
}

export default CustomersPage;
