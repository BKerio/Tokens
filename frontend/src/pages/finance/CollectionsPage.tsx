import { useMemo, useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Download, FileSignature, Gauge, HandCoins, Search, Undo2, Zap } from 'lucide-react';
import {
  allocateToRent, listCollections, resolvePayment, searchCollectionLeases, vendToMeter,
  type CollectionQuery, type CollectionRow, type CollectionStatus, type CollectionStream,
} from '@/api/collections';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { fmtKes } from '@/lib/format';
import { fmtDateTime, nairobiTodayISO } from '@/lib/datetime';
import { useAuthStore } from '@/stores/authStore';
import AppLoader from '@/components/shared/AppLoader';
import { ChoiceTiles, FormSheet, SheetField, SheetNote, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, Pagination } from '@/components/shared/ui';

const STREAM_LABEL: Record<CollectionStream, string> = { RENT: 'Rent', ELECTRICITY: 'Electricity', WATER: 'Water', OTHER: 'Other meters', UNASSIGNED: 'Unassigned' };
const STATUS_LABEL: Record<CollectionStatus, string> = {
  MATCHED: 'Matched', VERIFIED: 'Verified', RECORDED: 'Recorded by hand', EXCEPTION: 'Needs attention', RESOLVED: 'Resolved', PENDING: 'Pending', FAILED: 'Failed',
};
const RESOLUTION_LABEL = { RENT_ALLOCATED: 'Allocated to rent', TOKEN_ISSUED: 'Token issued manually', REFUNDED: 'Refunded', WRITTEN_OFF: 'Written off' } as const;

type Group = 'ALL' | 'ATTENTION' | 'RECONCILED' | 'RECORDED' | 'PENDING' | 'FAILED';
const GROUP_STATUSES: Record<Group, CollectionStatus[] | undefined> = {
  ALL: undefined, ATTENTION: ['EXCEPTION'], RECONCILED: ['MATCHED', 'VERIFIED', 'RESOLVED'], RECORDED: ['RECORDED'], PENDING: ['PENDING'], FAILED: ['FAILED'],
};

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom';
const shift = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
function rangeFor(p: Preset, custom: { from: string; to: string }) {
  const today = nairobiTodayISO();
  if (p === 'today') return { from: today, to: today };
  if (p === '7d') return { from: shift(today, -6), to: today };
  if (p === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (p === 'custom') return custom;
  return { from: shift(today, -29), to: today };
}

/** Allocate to rent, issue the token to the right meter, or mark refunded / written off. */
function ReconcileSheet({ row, onClose }: { row: CollectionRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  type Action = 'rent' | 'vend' | 'REFUNDED' | 'WRITTEN_OFF';
  const actions: { value: Action; label: string; hint: string; Icon: typeof Zap }[] = [
    ...(row.canAllocate ? [{ value: 'rent' as const, label: 'Allocate to rent', hint: 'Post it to a lease as a rent payment', Icon: FileSignature }] : []),
    ...(row.canVend ? [{ value: 'vend' as const, label: 'Issue the token', hint: 'Vend to the meter it was meant for', Icon: Zap }] : []),
    ...(row.canResolve ? [
      { value: 'REFUNDED' as const, label: 'Refunded', hint: 'Money was returned to the payer', Icon: Undo2 },
      { value: 'WRITTEN_OFF' as const, label: 'Write off', hint: 'Not ours / can’t be recovered', Icon: Ban },
    ] : []),
  ];
  const [action, setAction] = useState<Action>(row.suggestion && row.canAllocate ? 'rent' : actions[0]?.value ?? 'REFUNDED');
  const [leaseSearch, setLeaseSearch] = useState(row.suggestion?.code ?? '');
  const [leaseId, setLeaseId] = useState(row.suggestion?.leaseId ?? '');
  const [meterNumber, setMeterNumber] = useState(row.account && /^\d{6,}$/.test(row.account) ? row.account : '');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: leases = [], isFetching } = useQuery({
    queryKey: ['collection-leases', leaseSearch],
    queryFn: () => searchCollectionLeases(leaseSearch),
    enabled: action === 'rent',
  });

  const problem = action === 'rent' ? (!leaseId ? 'Choose the lease to allocate to' : null)
    : action === 'vend' ? (meterNumber.trim().length < 6 ? 'Enter the meter number' : null)
      : note.trim().length < 3 ? 'Add a short note for the record' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    setBusy(true);
    try {
      if (action === 'rent') await allocateToRent(row.id, leaseId, note.trim() || undefined);
      else if (action === 'vend') await vendToMeter(row.id, meterNumber.trim());
      else await resolvePayment(row.id, action, note.trim());
      for (const key of [['collections'], ['leases'], ['ledger'], ['statement'], ['arrears']]) queryClient.invalidateQueries({ queryKey: key });
      notify('success', action === 'rent' ? 'Allocated to rent' : action === 'vend' ? 'Token issued and sent' : 'Payment reconciled');
      onClose();
    } catch (err) {
      notify('error', 'Could not reconcile', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      icon={HandCoins}
      title="Reconcile payment"
      subtitle={row.reason ?? 'Money was received but nothing was issued or allocated for it.'}
      width={680}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      submitLabel={action === 'rent' ? 'Allocate to rent' : action === 'vend' ? 'Issue token' : action === 'REFUNDED' ? 'Mark refunded' : 'Write off'}
      meta={<><HandCoins size={15} /> <b>{fmtKes(row.amount)}</b> · {row.reference ?? 'no receipt'}</>}
    >
      <div className="cl-receipt">
        <span><small>Amount</small><b>{fmtKes(row.amount)}</b></span>
        <span><small>Receipt</small><b className="mono">{row.reference ?? '-'}</b></span>
        <span><small>From</small><b>{row.payer.name ?? '-'}</b><em>{row.payer.phone ?? ''}</em></span>
        <span><small>Account used</small><b className="mono">{row.account ?? '-'}</b><em>{row.channel} · {fmtDateTime(row.date)}</em></span>
      </div>

      <SheetSection id="action" title="What happened to this money?" Icon={HandCoins}>
        <ChoiceTiles value={action} onChange={setAction} cols={2} label="Resolution" options={actions} />

        {action === 'rent' && (
          <>
            {row.suggestion && (
              <SheetNote>The payer used lease code <b className="mono">{row.suggestion.code}</b> ({row.suggestion.tenantName}, {row.suggestion.unitName}) as the account, so it’s most likely rent.</SheetNote>
            )}
            <SheetField label="Lease" required error={tried && !leaseId ? 'Choose the lease to allocate to' : undefined}>
              <span className="cl-search"><Search size={15} /><input className="input" placeholder="Lease code, tenant, phone or unit…" value={leaseSearch} onChange={(e) => setLeaseSearch(e.target.value)} /></span>
            </SheetField>
            <div className="fs-picks">
              {isFetching && !leases.length ? <span className="fs-picks-empty"><AppLoader size={14} /> Searching…</span>
                : leases.length === 0 ? <span className="fs-picks-empty">No active leases match.</span>
                  : leases.map((l) => (
                    <button key={l.leaseId} type="button" className={`fs-pick${leaseId === l.leaseId ? ' on' : ''}`} onClick={() => setLeaseId(l.leaseId)}>
                      <span className="fs-pick-av">{l.tenantName.slice(0, 1).toUpperCase()}</span>
                      <span className="fs-pick-main"><b>{l.tenantName}</b><small>{l.unitName} · {l.propertyName} · <span className="mono">{l.code}</span></small></span>
                      <span className="fs-pick-bal" style={{ color: 'var(--muted)' }}>{fmtKes(l.rent)}</span>
                    </button>
                  ))}
            </div>
            <SheetField label="Note" aside="Optional"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Tenant paid into the TokenPap paybill" /></SheetField>
          </>
        )}

        {action === 'vend' && (
          <SheetField label="Meter number" required hint="A token for the full amount is issued and sent to the payer by SMS." error={tried ? problem ?? undefined : undefined}>
            <span className="cl-search"><Gauge size={15} /><input className="input mono" inputMode="numeric" value={meterNumber} onChange={(e) => setMeterNumber(e.target.value.replace(/\s/g, ''))} placeholder="e.g. 0412778812" /></span>
          </SheetField>
        )}

        {(action === 'REFUNDED' || action === 'WRITTEN_OFF') && (
          <SheetField label="Note" required hint="Kept on the payment for the audit trail." error={tried ? problem ?? undefined : undefined}>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === 'REFUNDED' ? 'e.g. Reversed via M-Pesa on 22 Oct' : 'e.g. Payer unreachable after 3 attempts'} />
          </SheetField>
        )}
      </SheetSection>
    </FormSheet>
  );
}

function toCsv(rows: CollectionRow[]) {
  const head = ['Date', 'Stream', 'Status', 'Amount', 'Channel', 'Receipt', 'Payer', 'Phone', 'Account', 'Owner', 'Place', 'Reason / note'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.date, STREAM_LABEL[r.stream], r.resolution ? RESOLUTION_LABEL[r.resolution] : STATUS_LABEL[r.status], r.amount, r.channel, r.reference,
    r.payer.name, r.payer.phone, r.account, r.owner, r.place, r.reason ?? r.resolutionNote,
  ].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}

/** Money received - rent and token payments - and how much of it is reconciled. */
export default function CollectionsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isVendor = role === 'VENDOR';
  const [preset, setPreset] = useState<Preset>('30d');
  const [custom, setCustom] = useState({ from: shift(nairobiTodayISO(), -29), to: nairobiTodayISO() });
  const [stream, setStream] = useState<CollectionStream | 'ALL'>('ALL');
  const [group, setGroup] = useState<Group>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reconciling, setReconciling] = useState<CollectionRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = rangeFor(preset, custom);
  const query: CollectionQuery = { ...range, stream: stream === 'ALL' ? undefined : stream, status: GROUP_STATUSES[group], search: search.trim() || undefined, page, limit: 25 };
  const { data, isLoading, isFetching } = useQuery({ queryKey: ['collections', query], queryFn: () => listCollections(query), placeholderData: keepPreviousData });
  const s = data?.summary;

  const streams = useMemo(() => (s?.byStream ?? []).filter((x) => x.stream === 'RENT' ? !isVendor : x.amount > 0 || ['ELECTRICITY', 'WATER'].includes(x.stream)), [s, isVendor]);
  const peak = Math.max(1, ...(s?.daily ?? []).map((d) => d.RENT + d.ELECTRICITY + d.WATER + d.OTHER + d.UNASSIGNED));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await listCollections({ ...query, page: 1, limit: 5000 });
      const blob = new Blob([toCsv(all.data)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `collections_${range.from}_${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      notify('error', 'Export failed', errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const set = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Finance"
        title="Collections"
        subtitle={isVendor
          ? 'Token payments for your meters, and whether each one issued a token.'
          : role === 'LANDLORD' || role === 'LANDLORD_STAFF'
            ? 'Rent and token payments for your properties, and what still needs reconciling.'
            : 'Every payment received across TokenPap - rent and tokens - and what still needs reconciling.'}
        actions={
          <>
            <div className="seg" aria-label="Period">
              {([['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['custom', 'Custom']] as [Preset, string][]).map(([p, label]) => (
                <button key={p} className={preset === p ? 'on' : ''} onClick={() => { setPreset(p); setPage(1); }}>{label}</button>
              ))}
            </div>
            <button className="ux-view" onClick={exportCsv} disabled={exporting || !data}>{exporting ? <AppLoader size={14} /> : <Download size={14} strokeWidth={1.75} />} Export</button>
          </>
        }
      />
      {preset === 'custom' && (
        <div className="cl-custom">
          <label>From <input type="date" className="input" value={custom.from} max={custom.to} onChange={(e) => { setCustom({ ...custom, from: e.target.value }); setPage(1); }} /></label>
          <label>To <input type="date" className="input" value={custom.to} min={custom.from} max={nairobiTodayISO()} onChange={(e) => { setCustom({ ...custom, to: e.target.value }); setPage(1); }} /></label>
        </div>
      )}

      {isLoading || !s ? <LoadingBlock /> : (
        <>
          <section className="card ux-summary" aria-label="Collections summary">
            <dl className="ux-kpis cl-kpis">
              <div>
                <dt>Received</dt>
                <dd><b>{fmtKes(s.received.amount)}</b></dd>
                <span className="ux-foot">{s.received.count} payment{s.received.count === 1 ? '' : 's'}</span>
              </div>
              <div>
                <dt>Reconciled</dt>
                <dd><b>{s.matchRate}%</b><span className="ux-unit">{fmtKes(s.reconciled.amount)}</span></dd>
                <span className="ux-track" aria-hidden="true"><i style={{ width: `${Math.min(100, s.matchRate)}%` }} /></span>
              </div>
              <div>
                <dt>Needs attention</dt>
                <dd><b>{s.exceptions.count}</b><span className="ux-unit">{fmtKes(s.exceptions.amount)}</span></dd>
                {s.exceptions.count > 0
                  ? <button type="button" className="ux-action" onClick={() => { setGroup('ATTENTION'); setPage(1); }}>Review {s.exceptions.count === 1 ? 'it' : 'them'} <span aria-hidden="true">→</span></button>
                  : <span className="ux-foot">Nothing unmatched</span>}
              </div>
              <div>
                <dt>{isVendor ? 'Pending' : 'Recorded by hand'}</dt>
                {isVendor
                  ? <><dd><b>{s.pending.count}</b><span className="ux-unit">{fmtKes(s.pending.amount)}</span></dd><span className="ux-foot">Awaiting M-Pesa confirmation</span></>
                  : <><dd><b>{s.manual.count}</b><span className="ux-unit">{fmtKes(s.manual.amount)}</span></dd><span className="ux-foot">Cash, bank or unmatched receipts</span></>}
              </div>
            </dl>

            <div className="cl-break">
              <div className="cl-streams">
                <h4>By stream</h4>
                {streams.map((x) => {
                  const share = s.received.amount ? Math.round((x.amount / s.received.amount) * 100) : 0;
                  return (
                    <button key={x.stream} type="button" className={`cl-stream${stream === x.stream ? ' on' : ''}`} onClick={() => set(setStream)(stream === x.stream ? 'ALL' : x.stream)}>
                      <span className="cl-stream-top"><span><i className={`cl-dot ${x.stream}`} />{STREAM_LABEL[x.stream]}</span><b>{fmtKes(x.amount)}</b></span>
                      <span className="ux-track"><i className={`cl-fill ${x.stream}`} style={{ width: `${share}%` }} /></span>
                      <small>{x.count} payment{x.count === 1 ? '' : 's'} · {share}%</small>
                    </button>
                  );
                })}
              </div>

              <div className="cl-chart">
                <h4>Daily <small>{s.daily.length} days</small></h4>
                <div className="cl-bars" role="img" aria-label="Money received per day">
                  {s.daily.map((d) => {
                    const total = d.RENT + d.ELECTRICITY + d.WATER + d.OTHER + d.UNASSIGNED;
                    return (
                      <span key={d.date} className="cl-col" title={`${d.date}: ${fmtKes(total)}`}>
                        <span className="cl-stack" style={{ height: `${(total / peak) * 100}%` }}>
                          {(['RENT', 'ELECTRICITY', 'WATER', 'OTHER', 'UNASSIGNED'] as CollectionStream[]).map((k) => d[k] > 0 && <i key={k} className={k} style={{ flexGrow: d[k] }} />)}
                        </span>
                      </span>
                    );
                  })}
                </div>
                <div className="cl-axis"><span>{s.daily[0]?.date.slice(5)}</span><span>{s.daily[s.daily.length - 1]?.date.slice(5)}</span></div>
              </div>

              <div className="cl-channels">
                <h4>By channel</h4>
                {s.byChannel.length === 0 ? <span className="ux-foot">No payments in this period</span> : s.byChannel.map((c) => (
                  <span key={c.channel} className="cl-channel"><span>{c.channel}</span><b>{fmtKes(c.amount)}</b><small>{c.count}</small></span>
                ))}
              </div>
            </div>
          </section>

          <div className="card">
            <div className="card-pad un-toolbar">
              <div className="seg">
                {([['ALL', 'All'], ['ATTENTION', 'Needs attention'], ['RECONCILED', 'Reconciled'], ...(!isVendor ? [['RECORDED', 'Recorded by hand']] : []), ['PENDING', 'Pending'], ['FAILED', 'Failed']] as [Group, string][]).map(([g, label]) => (
                  <button key={g} className={group === g ? 'on' : ''} onClick={() => set(setGroup)(g)}>
                    {label}{g === 'ATTENTION' && s.exceptions.count > 0 && <span className="ux-count cl-attn">{s.exceptions.count}</span>}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {stream !== 'ALL' && <button className="ux-set" onClick={() => set(setStream)('ALL')}>{STREAM_LABEL[stream]} ×</button>}
                <span className="cl-search"><Search size={15} /><input className="input" placeholder="Receipt, phone, name, meter or lease…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></span>
              </div>
            </div>

            {data.data.length === 0 ? (
              <EmptyState icon={<HandCoins size={28} />} title="No payments match" hint="Try another period, stream or filter." />
            ) : (
              <div className="tbl-wrap" style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity .15s' }}>
                <table className="tbl ut-table cl-table">
                  <thead><tr>{['Date', 'Payer', 'For', 'Channel & receipt', 'Amount', 'Status', ''].map((h) => <th key={h} className={h === 'Amount' ? 'num' : undefined}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.data.map((r) => (
                      <tr key={`${r.kind}-${r.id}`}>
                        <td className="cl-date">{fmtDateTime(r.date)}</td>
                        <td><span className="rn-strong">{r.payer.name ?? 'Unknown payer'}</span><span className="rn-sub">{r.payer.phone ?? '-'}</span></td>
                        <td>
                          <span className="cl-for"><i className={`cl-dot ${r.stream}`} />{STREAM_LABEL[r.stream]}</span>
                          <span className="rn-sub"><span className="mono">{r.account ?? '-'}</span>{r.place ? ` · ${r.place}` : r.owner ? ` · ${r.owner}` : ''}</span>
                        </td>
                        <td><span className="rn-strong" style={{ fontWeight: 500 }}>{r.channel}</span><span className="rn-sub mono">{r.reference ?? '-'}</span></td>
                        <td className="num"><b className="cl-amt">{fmtKes(r.amount)}</b></td>
                        <td>
                          <span className={`cl-status ${r.status}`}><i />{r.resolution ? RESOLUTION_LABEL[r.resolution] : STATUS_LABEL[r.status]}</span>
                          {(r.reason || r.resolutionNote) && <span className="rn-sub cl-reason">{r.status === 'RESOLVED' ? r.resolutionNote : r.reason}{r.resolvedBy ? ` · ${r.resolvedBy}` : ''}</span>}
                          {r.suggestion && <span className="rn-sub cl-hint">Looks like rent for {r.suggestion.code}</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {r.status === 'EXCEPTION' && (r.canAllocate || r.canVend || r.canResolve) && (
                            <button className="ux-view" onClick={() => setReconciling(r)}><HandCoins size={14} strokeWidth={1.75} /> Reconcile</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination meta={data.meta} onPage={setPage} />
          </div>
        </>
      )}

      {reconciling && <ReconcileSheet row={reconciling} onClose={() => setReconciling(null)} />}
    </div>
  );
}
