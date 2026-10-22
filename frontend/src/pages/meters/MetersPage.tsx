import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Droplets, Flame, Gauge, Home, KeyRound, Link2, Pencil, Plus, Store, Tag, Trash2, Unlink, Zap } from 'lucide-react';
import { createMeter, deleteMeter, listMeters, updateMeter, type MeterInput } from '@/api/meters';
import { listLandlords, listVendors } from '@/api/accounts';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { fmtKes, humanize, statusPill, toNum } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import { AmountInput, ChoiceChips, ChoiceTiles, FormSheet, SheetField, SheetGrid, SheetNote, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput } from '@/components/shared/ui';
import { ADMIN_ROLES, type Meter, type MeterStatus } from '@/types/api';

const optionalInt = z.string().trim().regex(/^\d*$/, 'Whole number').optional();

const schema = z.object({
  meterNumber: z.string().trim().min(1, 'Required'),
  type: z.string().trim().min(1, 'Required'),
  initialReading: z.string().trim().regex(/^\d*\.?\d*$/, 'Number').optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']),
  ownerType: z.enum(['NONE', 'VENDOR', 'LANDLORD']),
  vendorId: z.string().optional(),
  landlordId: z.string().optional(),
  sgc: optionalInt, krn: optionalInt, ti: optionalInt, ea: optionalInt, ken: optionalInt,
});
type MeterForm = z.infer<typeof schema>;

/** A meter has one owner: a vendor (sells tokens on it) or a landlord (links it to a unit). */
const ownerSchema = schema
  .refine((d) => d.ownerType !== 'VENDOR' || !!d.vendorId, { message: 'Choose the vendor', path: ['vendorId'] })
  .refine((d) => d.ownerType !== 'LANDLORD' || !!d.landlordId, { message: 'Choose the landlord', path: ['landlordId'] });

const intOrNull = (v?: string) => (v ? Number(v) : null);

function MeterModal({ meter, onClose }: { meter?: Meter; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: vendors } = useQuery({ queryKey: ['vendors', 'options'], queryFn: () => listVendors({ page: 1, limit: 200 }) });
  const { data: landlords } = useQuery({ queryKey: ['landlords', 'options'], queryFn: () => listLandlords({ page: 1, limit: 200 }) });
  const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<MeterForm>({
    resolver: zodResolver(ownerSchema),
    defaultValues: meter
      ? {
          meterNumber: meter.meterNumber, type: meter.type, initialReading: String(toNum(meter.initialReading)), status: meter.status,
          ownerType: meter.vendorId ? 'VENDOR' : meter.landlordId ? 'LANDLORD' : 'NONE',
          vendorId: meter.vendorId ?? '', landlordId: meter.landlordId ?? '',
          sgc: str(meter.sgc), krn: str(meter.krn), ti: str(meter.ti), ea: str(meter.ea), ken: str(meter.ken),
        }
      : { type: 'electricity', status: 'ACTIVE', ownerType: 'NONE', vendorId: '', landlordId: '' },
  });

  const onSubmit = async (f: MeterForm) => {
    const payload: MeterInput = {
      meterNumber: f.meterNumber,
      type: f.type,
      initialReading: f.initialReading ? Number(f.initialReading) : undefined,
      status: f.status,
      vendorId: f.ownerType === 'VENDOR' ? f.vendorId || null : null,
      landlordId: f.ownerType === 'LANDLORD' ? f.landlordId || null : null,
      sgc: intOrNull(f.sgc), krn: intOrNull(f.krn), ti: intOrNull(f.ti), ea: intOrNull(f.ea), ken: intOrNull(f.ken),
    };
    try {
      if (meter) await updateMeter(meter.id, payload);
      else await createMeter(payload);
      queryClient.invalidateQueries({ queryKey: ['meters'] });
      notify('success', meter ? 'Meter updated' : 'Meter created');
      onClose();
    } catch (err) {
      notify('error', 'Could not save meter', errorMessage(err));
    }
  };

  const v = watch();
  const owner = v.ownerType === 'VENDOR' ? vendors?.data.find((x) => x.id === v.vendorId)?.businessName
    : v.ownerType === 'LANDLORD' ? landlords?.data.find((x) => x.id === v.landlordId)?.fullName : 'Unassigned';
  const losingLandlord = !!meter?.landlordId && (v.ownerType !== 'LANDLORD' || v.landlordId !== meter.landlordId);
  return (
    <FormSheet
      icon={Gauge}
      title={meter ? `Edit meter ${meter.meterNumber}` : 'New meter'}
      subtitle="Register a prepaid meter and choose who sells tokens on it. The price per unit is set by the meter’s vendor."
      steps={[
        { id: 'meter', title: 'Meter', Icon: Gauge, done: !!(v.meterNumber ?? '').trim() },
        { id: 'owner', title: 'Assignment', Icon: Link2, done: v.ownerType === 'NONE' || (v.ownerType === 'VENDOR' ? !!v.vendorId : !!v.landlordId) },
        { id: 'sts', title: 'STS keys', Icon: KeyRound, done: true },
      ]}
      width={720}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
      busy={isSubmitting}
      submitLabel={meter ? 'Save meter' : 'Register meter'}
      meta={<><Gauge size={15} /> <b className="mono">{(v.meterNumber ?? '').trim() || 'New meter'}</b>{owner && <> · {owner}</>}</>}
    >
      <SheetSection id="meter">
        <div className="vf-field">
          <span className="vf-label">Type</span>
          <ChoiceTiles
            value={v.type}
            onChange={(t) => setValue('type', t)}
            label="Meter type"
            options={[
              { value: 'electricity', label: 'Electricity', hint: 'kWh tokens', Icon: Zap },
              { value: 'water', label: 'Water', hint: 'm³ tokens', Icon: Droplets },
              { value: 'gas', label: 'Gas', hint: 'Gas tokens', Icon: Flame },
            ]}
          />
        </div>
        <SheetGrid>
          <SheetField label="Meter number (DRN)" required error={errors.meterNumber?.message}><input className="input mono" autoFocus={!meter} {...register('meterNumber')} /></SheetField>
          <SheetField label="Initial reading" aside="Optional" error={errors.initialReading?.message}><input className="input mono" inputMode="decimal" {...register('initialReading')} /></SheetField>
        </SheetGrid>
        <div className="vf-field">
          <span className="vf-label">Status</span>
          <ChoiceChips
            value={v.status}
            onChange={(s) => setValue('status', s)}
            label="Status"
            options={[{ value: 'ACTIVE', label: 'Active', tone: 'ok' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'MAINTENANCE', label: 'Maintenance', tone: 'warn' }]}
          />
        </div>
      </SheetSection>

      <SheetSection id="owner">
        <div className="vf-field">
          <span className="vf-label-row"><span className="vf-label">Who is this meter for?</span><small>One owner at a time</small></span>
          <ChoiceTiles
            value={v.ownerType}
            onChange={(t) => setValue('ownerType', t)}
            label="Meter owner"
            options={[
              { value: 'NONE', label: 'Unassigned', hint: 'Keep it in stock', Icon: Unlink },
              { value: 'VENDOR', label: 'A vendor', hint: 'Sells tokens on it', Icon: Store },
              { value: 'LANDLORD', label: 'A landlord', hint: 'Links it to a unit', Icon: Home },
            ]}
          />
        </div>
        {v.ownerType === 'VENDOR' && (
          <SheetField label="Vendor" required error={errors.vendorId?.message}>
            <select className="eoc-select" {...register('vendorId')}>
              <option value="">Choose a vendor…</option>
              {vendors?.data.map((x) => <option key={x.id} value={x.id}>{x.businessName}</option>)}
            </select>
          </SheetField>
        )}
        {v.ownerType === 'LANDLORD' && (
          <SheetField label="Landlord" required error={errors.landlordId?.message}>
            <select className="eoc-select" {...register('landlordId')}>
              <option value="">Choose a landlord…</option>
              {landlords?.data.map((l) => <option key={l.id} value={l.id}>{l.fullName}</option>)}
            </select>
          </SheetField>
        )}
        {losingLandlord && meter?.landlord && (
          <SheetNote tone="warn">This meter leaves <b>{meter.landlord.fullName}</b> and is unlinked from their unit.</SheetNote>
        )}
      </SheetSection>

      <SheetSection id="sts" aside="Optional">
        <p className="vf-hint" style={{ margin: 0 }}>Leave blank to use the global defaults from Settings → Vending Control. A value here wins over the default.</p>
        <div className="fs-sts">
          {(['sgc', 'krn', 'ti', 'ea', 'ken'] as const).map((k) => (
            <SheetField key={k} label={k.toUpperCase()} error={errors[k]?.message}><input className="input mono" inputMode="numeric" {...register(k)} /></SheetField>
          ))}
        </div>
      </SheetSection>
    </FormSheet>
  );
}

function PriceModal({ meter, onClose }: { meter: Meter; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(String(toNum(meter.pricePerUnit) || ''));
  const save = useMutation({
    mutationFn: () => updateMeter(meter.id, { pricePerUnit: Number(price) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meters'] });
      notify('success', 'Price updated');
      onClose();
    },
    onError: (err) => notify('error', 'Could not update price', errorMessage(err)),
  });
  const current = toNum(meter.pricePerUnit);
  const n = Number(price);
  return (
    <FormSheet
      icon={Tag}
      title={`Price for ${meter.meterNumber}`}
      subtitle="Used to convert a customer’s payment into units on their token SMS."
      width={520}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); if (price !== '' && n >= 0) save.mutate(); }}
      busy={save.isPending}
      submitLabel="Save price"
      meta={n > 0 ? <><Tag size={15} /> KES 1,000 buys <b>{(1000 / n).toFixed(2)} units</b></> : <><Tag size={15} /> No price set</>}
    >
      <SheetSection id="price" title="Price per unit" Icon={Tag}>
        <AmountInput value={price} onChange={setPrice} autoFocus label="Price per unit" presets={current > 0 ? [{ label: `Keep ${fmtKes(current)}`, amount: current }] : []} />
      </SheetSection>
    </FormSheet>
  );
}

function MetersPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = !!role && ADMIN_ROLES.includes(role);
  const isVendor = role === 'VENDOR';
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MeterStatus | ''>('');
  const [editing, setEditing] = useState<Meter | 'new' | null>(null);
  const [pricing, setPricing] = useState<Meter | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['meters', page, search, status],
    queryFn: () => listMeters({ page, limit: 20, search: search || undefined, status: status || undefined }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: deleteMeter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meters'] });
      notify('success', 'Meter deleted');
    },
    onError: (err) => notify('error', 'Delete failed', errorMessage(err)),
  });

  const onDelete = async (m: Meter) => {
    if (await confirmDialog({ title: 'Delete this meter?', subject: { name: m.meterNumber, detail: [m.vendor?.businessName, m.landlord?.fullName].filter(Boolean).join(' · ') || 'Unassigned', icon: 'gauge' }, removes: ['The meter and its links to vendors, landlords and units'], keeps: ['Its transaction history'], irreversible: true, confirmLabel: 'Delete meter', danger: true })) remove.mutate(m.id);
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Inventory"
        title={isVendor ? 'My meters' : 'Meter management'}
        subtitle={isAdmin ? <>Every prepaid meter on the platform. See who holds each meter under <Link to="/meters/assigned" style={{ color: 'var(--green)', fontWeight: 600 }}>Assigned Meters</Link>.</> : isVendor ? 'Meters assigned to you - set the price per unit customers pay.' : 'Meters assigned to your properties.'}
        actions={isAdmin && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> New meter</button>}
      />
      <div className="card">
        <div className="card-pad flex gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search meter number…" />
          <select className="eoc-select" value={status} onChange={(e) => { setStatus(e.target.value as MeterStatus | ''); setPage(1); }}>
            <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="MAINTENANCE">Maintenance</option>
          </select>
        </div>
        {isLoading ? <LoadingBlock /> : !data?.data.length ? (
          <EmptyState icon={<Gauge size={28} />} title="No meters found" hint={isAdmin ? undefined : 'Meters are assigned to you by TokenPap administrators.'} />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>{['Meter', 'Type', 'Price / unit', ...(isAdmin ? [] : ['Customers']), 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.data.map((m) => (
                  <tr key={m.id}>
                    <td className="strong mono">{m.meterNumber}</td>
                    <td>{humanize(m.type)}</td>
                    <td>{toNum(m.pricePerUnit) > 0 ? fmtKes(m.pricePerUnit) : <span style={{ color: 'var(--amber)' }}>Not set</span>}</td>
                    {!isAdmin && <td>{m._count?.customers ?? 0}</td>}
                    <td><span className={statusPill(m.status)}>{m.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link className="icon-btn" title="Vend token" to={`/tokens?meter=${encodeURIComponent(m.meterNumber)}`}><Zap size={14} /></Link>
                      {isVendor && <button className="btn btn-soft btn-sm" onClick={() => setPricing(m)}><Tag size={13} /> Set price</button>}
                      {isAdmin && (
                        <>
                          <button className="icon-btn" title="Edit" onClick={() => setEditing(m)}><Pencil size={14} /></button>
                          <button className="icon-btn" title="Delete" onClick={() => onDelete(m)}><Trash2 size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      {editing && <MeterModal meter={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {pricing && <PriceModal meter={pricing} onClose={() => setPricing(null)} />}
    </div>
  );
}

export default MetersPage;
