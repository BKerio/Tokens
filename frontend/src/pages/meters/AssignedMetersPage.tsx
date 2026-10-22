import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Gauge, Plus, Unlink } from 'lucide-react';
import { listMeters, updateMeter } from '@/api/meters';
import { listVendors } from '@/api/accounts';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { fmtKes, humanize, statusPill, toNum } from '@/lib/format';
import { FormSheet, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, SearchInput } from '@/components/shared/ui';
import type { Meter, Vendor } from '@/types/api';

/** Picks a meter that has no vendor yet and hands it to `vendor`. */
function AssignModal({ vendor, meters, onClose }: { vendor: Vendor; meters: Meter[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [meterId, setMeterId] = useState('');
  const free = meters.filter((m) => !m.vendorId);

  const assign = useMutation({
    mutationFn: () => updateMeter(meterId, { vendorId: vendor.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meters'] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      notify('success', `Meter assigned to ${vendor.businessName}`);
      onClose();
    },
    onError: (err) => notify('error', 'Could not assign meter', errorMessage(err)),
  });

  const [search, setSearch] = useState('');
  const shown = free.filter((m) => !search.trim() || m.meterNumber.includes(search.trim())).slice(0, 12);
  const chosen = free.find((m) => m.id === meterId);
  return (
    <FormSheet
      icon={Gauge}
      title="Assign a meter"
      subtitle={<>Give <b style={{ color: 'var(--ink)' }}>{vendor.businessName}</b> a meter that has no vendor yet.</>}
      width={620}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); if (meterId) assign.mutate(); }}
      busy={assign.isPending}
      submitLabel="Assign meter"
      meta={<><Gauge size={15} /> <b>{chosen ? chosen.meterNumber : `${free.length} free meter${free.length === 1 ? '' : 's'}`}</b></>}
    >
      <SheetSection id="meter" title="Meter" Icon={Gauge} aside={free.length ? `${free.length} available` : undefined}>
        {free.length === 0 ? (
          <EmptyState icon={<Gauge size={28} />} title="No free meters" hint="Every meter already has a vendor. Register a new meter on the Meters page first." />
        ) : (
          <>
            {free.length > 6 && <input className="input mono" placeholder="Search meter number…" value={search} onChange={(e) => setSearch(e.target.value.replace(/\s/g, ''))} />}
            <div className="fs-picks">
              {shown.length === 0 && <span className="fs-picks-empty">No free meters match.</span>}
              {shown.map((m) => (
                <button key={m.id} type="button" className={`fs-pick${meterId === m.id ? ' on' : ''}`} onClick={() => setMeterId(m.id)}>
                  <span className="fs-pick-av"><Gauge size={15} /></span>
                  <span className="fs-pick-main"><b className="mono">{m.meterNumber}</b><small>{humanize(m.type)}{m.landlord ? ` · ${m.landlord.fullName}` : ''}</small></span>
                </button>
              ))}
            </div>
          </>
        )}
      </SheetSection>
    </FormSheet>
  );
}

/** Admin view of meters grouped by the vendor they are assigned to. */
function AssignedMetersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState<Vendor | null>(null);

  const { data: vendors, isLoading: vendorsLoading } = useQuery({ queryKey: ['vendors', 'options'], queryFn: () => listVendors({ page: 1, limit: 200 }) });
  const { data: meters, isLoading: metersLoading } = useQuery({ queryKey: ['meters', 'all'], queryFn: () => listMeters({ page: 1, limit: 1000 }) });

  const byVendor = useMemo(() => {
    const map = new Map<string, Meter[]>();
    for (const m of meters?.data ?? []) {
      if (!m.vendorId) continue;
      map.set(m.vendorId, [...(map.get(m.vendorId) ?? []), m]);
    }
    for (const list of map.values()) list.sort((a, b) => a.meterNumber.localeCompare(b.meterNumber));
    return map;
  }, [meters]);

  const unassignedCount = (meters?.data ?? []).filter((m) => !m.vendorId).length;

  const q = search.trim().toLowerCase();
  const shown = (vendors?.data ?? []).filter(
    (v) => !q || v.businessName.toLowerCase().includes(q) || v.accountId.toLowerCase().includes(q)
      || (byVendor.get(v.id) ?? []).some((m) => m.meterNumber.toLowerCase().includes(q)),
  );

  const unassign = useMutation({
    mutationFn: (m: Meter) => updateMeter(m.id, { vendorId: null }),
    onSuccess: (_d, m) => {
      queryClient.invalidateQueries({ queryKey: ['meters'] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      notify('success', `Meter ${m.meterNumber} unassigned`);
    },
    onError: (err) => notify('error', 'Could not unassign meter', errorMessage(err)),
  });

  const onUnassign = async (m: Meter, v: Vendor) => {
    if (await confirmDialog({ title: 'Unassign meter', text: `Remove meter ${m.meterNumber} from ${v.businessName}? Its transaction history is kept.`, confirmLabel: 'Unassign', danger: true })) unassign.mutate(m);
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Inventory"
        title="Assigned meters"
        subtitle={`Meters held by each vendor.${unassignedCount ? ` ${unassignedCount} meter(s) have no vendor yet.` : ''}`}
      />
      <div className="card">
        <div className="card-pad flex gap-2 flex-wrap items-center justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search vendor or meter number…" />
          <span className="pill pill-gray">{shown.length} vendor(s)</span>
        </div>
      </div>

      {vendorsLoading || metersLoading ? <LoadingBlock /> : shown.length === 0 ? (
        <div className="card"><EmptyState icon={<Building2 size={28} />} title="No vendors found" /></div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {shown.map((v) => {
            const list = byVendor.get(v.id) ?? [];
            return (
              <div key={v.id} className="card col" style={{ overflow: 'hidden' }}>
                <div className="card-head">
                  <span className="col" style={{ minWidth: 0 }}>
                    <span className="card-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.businessName}</span>
                    <span className="text-xs mono" style={{ color: 'var(--muted)' }}>{v.accountId}{v.paybill ? ` · Paybill ${v.paybill}` : ''}</span>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{v._count.customers} customer(s)</span>
                  </span>
                  <span className={statusPill(v.status)}>{v.status}</span>
                </div>
                <div className="card-pad col" style={{ gap: 6, flex: 1 }}>
                  <p className="eyebrow">Meters ({list.length})</p>
                  {list.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>No meters assigned yet.</p>
                  ) : (
                    <div className="col scroll-thin" style={{ gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                      {list.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-2" style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                          <span className="col" style={{ minWidth: 0 }}>
                            <span className="text-sm mono strong">{m.meterNumber}</span>
                            <span className="text-xs" style={{ color: 'var(--muted)' }}>
                              {humanize(m.type)} · {toNum(m.pricePerUnit) > 0 ? `${fmtKes(m.pricePerUnit)}/unit` : 'price not set'} · {m._count?.customers ?? 0} customer(s)
                            </span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className={statusPill(m.status)}>{m.status}</span>
                            <button className="icon-btn" title="Unassign" onClick={() => onUnassign(m, v)} disabled={unassign.isPending}><Unlink size={14} /></button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="card-pad" style={{ borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-soft w-full" onClick={() => setAssigning(v)}><Plus size={14} /> Assign meter</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {assigning && <AssignModal vendor={assigning} meters={meters?.data ?? []} onClose={() => setAssigning(null)} />}
    </div>
  );
}

export default AssignedMetersPage;
