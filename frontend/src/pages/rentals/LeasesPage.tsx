import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileSignature, HandCoins, Plus } from 'lucide-react';
import { listLeases, listLocations } from '@/api/rentals';
import { listProperties } from '@/api/properties';
import { fmtKes } from '@/lib/format';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput } from '@/components/shared/ui';
import type { LeaseStatus } from '@/types/api';
import LeaseDrawer from './LeaseDrawer';
import LeaseFormModal from './LeaseFormModal';
import { AgingBar, FREQ_SHORT, fmtDay } from './rentUi';
import { MoneyModal } from './MoneyModal';

type Tab = 'ACTIVE' | 'ENDED' | 'ALL' | 'ARREARS';

export default function LeasesPage() {
  const { can } = useLandlordAccess();
  const [params, setParams] = useSearchParams();
  const tab = (['ACTIVE', 'ENDED', 'ALL', 'ARREARS'].includes(params.get('tab') ?? '') ? params.get('tab') : 'ACTIVE') as Tab;
  const openId = params.get('lease');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(false);

  const status: LeaseStatus | undefined = tab === 'ACTIVE' ? 'ACTIVE' : tab === 'ENDED' ? 'ENDED' : undefined;
  const { data, isLoading } = useQuery({
    queryKey: ['leases', tab, page, search, propertyId, locationId],
    queryFn: () => listLeases({ page, limit: 20, status, search: search || undefined, propertyId: propertyId || undefined, locationId: locationId || undefined, arrearsOnly: tab === 'ARREARS' }),
    placeholderData: keepPreviousData,
  });
  const { data: properties = [] } = useQuery({ queryKey: ['properties', ''], queryFn: () => listProperties() });
  const { data: locations = [] } = useQuery({ queryKey: ['locations'], queryFn: listLocations });

  const setTab = (t: Tab) => { setPage(1); setParams((p) => { p.set('tab', t); p.delete('lease'); return p; }); };
  const open = (id: string | null) => setParams((p) => { if (id) p.set('lease', id); else p.delete('lease'); return p; });

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Rentals"
        title="Leases"
        subtitle="Every tenancy, what it costs and what is owed. Rent is billed automatically on each lease's schedule."
        actions={
          <>
            {can('payments.record') && <button className="btn btn-ghost" onClick={() => setPaying(true)}><HandCoins size={16} /> Record payment</button>}
            {can('leases.manage') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New lease</button>}
          </>
        }
      />

      <div className="tabs">
        {([['ACTIVE', 'Active'], ['ARREARS', 'In arrears'], ['ENDED', 'Ended'], ['ALL', 'All']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="card">
        <div className="card-pad flex gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Tenant, phone, unit or lease code…" />
          {locations.length > 0 && (
            <select className="eoc-select" style={{ maxWidth: 200 }} value={locationId} onChange={(e) => { setLocationId(e.target.value); setPage(1); }}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <select className="eoc-select" style={{ maxWidth: 220 }} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setPage(1); }}>
            <option value="">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {isLoading ? <LoadingBlock /> : !data?.data.length ? (
          <EmptyState
            icon={<FileSignature size={28} />}
            title={tab === 'ARREARS' ? 'Nobody is in arrears' : 'No leases yet'}
            hint={tab === 'ACTIVE' && can('leases.manage') ? 'Create a lease to start billing a tenant automatically.' : undefined}
            action={tab === 'ACTIVE' && can('leases.manage') ? <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> New lease</button> : undefined}
          />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl rn-table">
              <thead><tr>{['Tenant', 'Unit', 'Rent', 'Balance', 'Arrears', 'Next due', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {data.data.map((l) => (
                  <tr key={l.id} onClick={() => open(l.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <b className="rn-strong">{l.tenant.name}</b>
                      <small className="rn-sub">{l.tenant.phone} · <span className="mono">{l.code}</span></small>
                    </td>
                    <td>
                      <b className="rn-strong">{l.unit.name}</b>
                      <small className="rn-sub">{l.property.name}{l.property.locationGroup ? ` · ${l.property.locationGroup.name}` : ''}</small>
                    </td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtKes(l.rentAmount)}<small className="rn-sub">{FREQ_SHORT[l.billingFrequency]}</small></td>
                    <td className="mono strong" style={{ color: l.account.balance > 0 ? 'var(--ink)' : '#157347' }}>{fmtKes(l.account.balance)}</td>
                    <td style={{ minWidth: 150 }}>
                      {l.account.arrears > 0 ? (
                        <><b className="mono" style={{ color: 'var(--red)' }}>{fmtKes(l.account.arrears)}</b><AgingBar aging={l.account.aging} compact /></>
                      ) : <span className="pill pill-green">Up to date</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{l.status === 'ACTIVE' ? (l.nextBillingDate ? fmtDay(l.nextBillingDate) : 'Final period billed') : <span className="pill pill-gray">Ended{l.endDate ? ` ${fmtDay(l.endDate, { day: 'numeric', month: 'short' })}` : ''}</span>}</td>
                    <td className="rn-chev">›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>

      {creating && <LeaseFormModal onClose={() => setCreating(false)} onCreated={(l) => open(l.id)} />}
      {paying && <MoneyModal kind="payment" onClose={() => setPaying(false)} />}
      {openId && <LeaseDrawer leaseId={openId} onClose={() => open(null)} />}
    </div>
  );
}
