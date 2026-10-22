import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Eye, Pencil, Plus, Trash2, X } from 'lucide-react';
import { deleteVendor, getVendorOversight, listPendingVendors, listVendors, setVendorApproval } from '@/api/accounts';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { fmtDate } from '@/lib/datetime';
import { fmtKes, humanize, statusPill } from '@/lib/format';
import { Drawer, EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput } from '@/components/shared/ui';
import type { Vendor } from '@/types/api';
import VendorFormModal from './VendorFormModal';

function OversightDrawer({ vendorId, onClose }: { vendorId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['vendor-oversight', vendorId], queryFn: () => getVendorOversight(vendorId) });
  return (
    <Drawer title={data?.vendor.businessName ?? 'Vendor'} onClose={onClose}>
      {isLoading || !data ? (
        <LoadingBlock height={240} />
      ) : (
        <>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[['Sales', fmtKes(data.totalSales)], ['Meters', data.metersCount], ['Customers', data.customersCount]].map(([l, v]) => (
              <div key={l} className="card card-pad"><p className="text-xs" style={{ color: 'var(--muted)' }}>{l}</p><p className="font-bold" style={{ color: 'var(--ink)' }}>{v}</p></div>
            ))}
          </div>
          <p className="eyebrow">Meters</p>
          {data.meters.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No meters assigned.</p> : data.meters.map((m) => (
            <div key={m.id} className="flex justify-between text-sm"><span className="mono">{m.meterNumber}</span><span className={statusPill(m.status)}>{m.status}</span></div>
          ))}
          <p className="eyebrow">Customers</p>
          {data.customers.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No customers yet.</p> : data.customers.map((c) => (
            <div key={c.id} className="flex justify-between text-sm"><span>{c.name} · {c.phone}</span><span className="mono" style={{ color: 'var(--muted)' }}>{c.meter?.meterNumber ?? '-'}</span></div>
          ))}
        </>
      )}
    </Drawer>
  );
}

function VendorsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'pending' ? 'pending' : 'all';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [overseeing, setOverseeing] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['vendors', page, search],
    queryFn: () => listVendors({ page, limit: 20, search: search || undefined }),
    placeholderData: keepPreviousData,
    enabled: tab === 'all',
  });
  const { data: pending = [], isLoading: pendingLoading } = useQuery({ queryKey: ['vendors', 'pending'], queryFn: listPendingVendors });

  const approval = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => setVendorApproval(id, approve),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      notify('success', v.approve ? 'Vendor approved' : 'Registration rejected');
    },
    onError: (err) => notify('error', 'Action failed', errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: deleteVendor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      notify('success', 'Vendor deleted', 'Their meters and customers were kept, unassigned.');
    },
    onError: (err) => notify('error', 'Delete failed', errorMessage(err)),
  });

  const onDelete = async (v: Vendor) => {
    if (await confirmDialog({ title: 'Delete vendor', text: `Delete ${v.businessName} and their login? Their ${v._count.meters} meter(s) will be unassigned.`, confirmLabel: 'Delete', danger: true })) {
      remove.mutate(v.id);
    }
  };

  const onReject = async (v: Vendor) => {
    if (await confirmDialog({ title: 'Reject registration', text: `Reject ${v.businessName}? They won't be able to sign in.`, confirmLabel: 'Reject', danger: true })) {
      approval.mutate({ id: v.id, approve: false });
    }
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Partners"
        title="Vendors"
        subtitle="Businesses and individuals who sell tokens on TokenPap."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Register vendor</button>}
      />

      <div className="tabs">
        <button className={`tab${tab === 'all' ? ' on' : ''}`} onClick={() => setParams({})}>All vendors</button>
        <button className={`tab${tab === 'pending' ? ' on' : ''}`} onClick={() => setParams({ tab: 'pending' })}>
          Pending approval {pending.length > 0 && <span className="pill pill-amber">{pending.length}</span>}
        </button>
      </div>

      {tab === 'pending' ? (
        <div className="card">
          {pendingLoading ? <LoadingBlock /> : pending.length === 0 ? (
            <EmptyState icon={<Check size={28} />} title="No registrations waiting" hint="New self-registered vendors appear here for approval." />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>{['Business', 'Type', 'Contact', 'Account ID', 'Bank', 'Registered', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {pending.map((v) => (
                    <tr key={v.id}>
                      <td className="strong">{v.businessName}</td>
                      <td>{humanize(v.vendorType)}</td>
                      <td>{v.user.name}<br /><span className="text-xs" style={{ color: 'var(--muted)' }}>{v.user.email} · {v.user.phone}</span></td>
                      <td className="mono">{v.accountId}</td>
                      <td>{v.bankName ?? '-'}</td>
                      <td>{fmtDate(v.createdAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => approval.mutate({ id: v.id, approve: true })}><Check size={14} /> Approve</button>{' '}
                        <button className="btn btn-ghost btn-sm" onClick={() => onReject(v)}><X size={14} /> Reject</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="card-pad" style={{ borderBottom: '1px solid var(--border)' }}>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search business, account ID, contact…" />
          </div>
          {isLoading ? <LoadingBlock /> : !data?.data.length ? (
            <EmptyState icon={<Building2 size={28} />} title="No vendors found" />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>{['Business', 'Type', 'Contact', 'Account ID', 'Meters', 'Customers', 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.data.map((v) => (
                    <tr key={v.id} onClick={() => setOverseeing(v.id)}>
                      <td className="strong">{v.businessName}</td>
                      <td>{humanize(v.vendorType)}</td>
                      <td>{v.user.name}<br /><span className="text-xs" style={{ color: 'var(--muted)' }}>{v.user.email}</span></td>
                      <td className="mono">{v.accountId}</td>
                      <td>{v._count.meters}</td>
                      <td>{v._count.customers}</td>
                      <td><span className={statusPill(v.status)}>{v.status}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" title="Oversight" onClick={() => setOverseeing(v.id)}><Eye size={14} /></button>
                        <button className="icon-btn" title="Edit" onClick={() => setEditing(v)}><Pencil size={14} /></button>
                        <button className="icon-btn" title="Delete" onClick={() => onDelete(v)}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination meta={data?.meta} onPage={setPage} />
        </div>
      )}

      {editing && <VendorFormModal vendor={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {overseeing && <OversightDrawer vendorId={overseeing} onClose={() => setOverseeing(null)} />}
    </div>
  );
}

export default VendorsPage;
