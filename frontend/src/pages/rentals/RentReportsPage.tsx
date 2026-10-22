import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { getRentReport } from '@/api/rentals';
import { fmtKes } from '@/lib/format';
import { nairobiTodayISO } from '@/lib/datetime';
import { downloadBlob } from '@/lib/downloadBlob';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/shared/ui';
import type { RentReport, RentReportRow } from '@/types/api';
import { AgingBar, fmtDay } from './rentUi';

type Preset = 'month' | 'last-month' | 'quarter' | 'year' | 'custom';

function rangeFor(p: Preset): [string, string] {
  const today = nairobiTodayISO();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (p) {
    case 'last-month': return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(new Date(Date.UTC(y, m - 1, 0)))];
    case 'quarter': { const q = Math.floor((m - 1) / 3) * 3; return [iso(new Date(Date.UTC(y, q, 1))), today]; }
    case 'year': return [`${y}-01-01`, today];
    default: return [`${today.slice(0, 8)}01`, today];
  }
}

const pct = (v: number | null) => (v === null ? '-' : `${v.toFixed(0)}%`);

const COLUMNS: { key: keyof RentReportRow; label: string; money?: boolean; render?: (r: RentReportRow) => string }[] = [
  { key: 'units', label: 'Units', render: (r) => `${r.occupied}/${r.units}` },
  { key: 'occupancyRate', label: 'Occupancy', render: (r) => pct(r.occupancyRate) },
  { key: 'rentRoll', label: 'Rent roll /mo', money: true },
  { key: 'billed', label: 'Billed', money: true },
  { key: 'collected', label: 'Collected', money: true },
  { key: 'collectionRate', label: 'Collection', render: (r) => pct(r.collectionRate) },
  { key: 'expenses', label: 'Expenses', money: true },
  { key: 'net', label: 'Net', money: true },
  { key: 'arrears', label: 'Arrears (now)', money: true },
  { key: 'depositsHeld', label: 'Deposits held', money: true },
];

function toCsv(report: RentReport) {
  const head = [report.groupBy === 'location' ? 'Location' : 'Property', ...(report.groupBy === 'property' ? ['Location'] : []), 'Units', 'Occupied', 'Rent roll per month', 'Billed', 'Collected', 'Credits', 'Expenses', 'Net', 'Arrears', 'Arrears 1-30', 'Arrears 31-60', 'Arrears 61-90', 'Arrears 90+', 'Deposits held'];
  const line = (r: RentReportRow) => [
    r.name, ...(report.groupBy === 'property' ? [r.location ?? ''] : []), r.units, r.occupied, r.rentRoll, r.billed, r.collected, r.credits, r.expenses, r.net,
    r.arrears, r.aging.d1_30, r.aging.d31_60, r.aging.d61_90, r.aging.d90plus, r.depositsHeld,
  ];
  const esc = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head, ...report.rows.map(line), line(report.totals)].map((r) => r.map(esc).join(',')).join('\n');
}

/** Property, location and portfolio reports for any period (arrears and deposits are as of today). */
export default function RentReportsPage() {
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState<[string, string]>(rangeFor('month'));
  const [groupBy, setGroupBy] = useState<'property' | 'location'>('location');
  const [from, to] = useMemo(() => (preset === 'custom' ? custom : rangeFor(preset)), [preset, custom]);

  const { data: report, isLoading } = useQuery({ queryKey: ['rent-report', from, to, groupBy], queryFn: () => getRentReport({ from, to, groupBy }) });

  return (
    <div className="col rn-report" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Rentals"
        title="Reports"
        subtitle={`${fmtDay(from)} – ${fmtDay(to)} · money for the period, arrears and deposits as of today`}
        actions={report && (
          <>
            <button className="btn btn-ghost" onClick={() => window.print()}><Printer size={16} /> Print</button>
            <button className="btn btn-primary" onClick={() => downloadBlob(new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' }), `rent-report-${groupBy}-${from}-to-${to}.csv`)}><Download size={16} /> CSV</button>
          </>
        )}
      />

      <div className="card card-pad flex gap-3 flex-wrap items-end rn-noprint">
        <div className="seg">
          {([['month', 'This month'], ['last-month', 'Last month'], ['quarter', 'This quarter'], ['year', 'This year'], ['custom', 'Custom']] as [Preset, string][]).map(([k, label]) => (
            <button key={k} type="button" className={preset === k ? 'on' : ''} onClick={() => setPreset(k)}>{label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <>
            <input className="input" type="date" style={{ maxWidth: 160 }} value={custom[0]} max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
            <input className="input" type="date" style={{ maxWidth: 160 }} value={custom[1]} min={custom[0]} onChange={(e) => setCustom([custom[0], e.target.value])} />
          </>
        )}
        <div className="seg" style={{ marginLeft: 'auto' }}>
          <button type="button" className={groupBy === 'location' ? 'on' : ''} onClick={() => setGroupBy('location')}>By location</button>
          <button type="button" className={groupBy === 'property' ? 'on' : ''} onClick={() => setGroupBy('property')}>By property</button>
        </div>
      </div>

      {isLoading || !report ? <LoadingBlock height={360} /> : (
        <>
          <div className="rn-totals">
            {([
              ['Billed', fmtKes(report.totals.billed)],
              ['Collected', fmtKes(report.totals.collected)],
              ['Collection rate', pct(report.totals.collectionRate)],
              ['Expenses', fmtKes(report.totals.expenses)],
              ['Net income', fmtKes(report.totals.net)],
              ['Arrears', fmtKes(report.totals.arrears)],
              ['Occupancy', `${report.totals.occupied}/${report.totals.units} · ${pct(report.totals.occupancyRate)}`],
              ['Deposits held', fmtKes(report.totals.depositsHeld)],
            ] as [string, string][]).map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}
          </div>

          <div className="card">
            {report.rows.length === 0 ? <EmptyState title="No properties yet" /> : (
              <div className="tbl-wrap">
                <table className="tbl rn-table rn-report-table">
                  <thead>
                    <tr><th>{groupBy === 'location' ? 'Location' : 'Property'}</th>{COLUMNS.map((c) => <th key={c.key} style={{ textAlign: 'right' }}>{c.label}</th>)}<th>Arrears aging</th></tr>
                  </thead>
                  <tbody>
                    {[...report.rows, report.totals].map((r) => (
                      <tr key={r.id} className={r.id === 'total' ? 'rn-total-row' : undefined}>
                        <td><b className="rn-strong">{r.name}</b>{groupBy === 'property' && r.location && <small className="rn-sub">{r.location}</small>}{groupBy === 'location' && r.id !== 'total' && <small className="rn-sub">{r.properties} propert{r.properties === 1 ? 'y' : 'ies'}</small>}</td>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap', color: c.key === 'arrears' && r.arrears > 0 ? 'var(--red)' : c.key === 'net' && r.net < 0 ? 'var(--red)' : undefined }}>
                            {c.render ? c.render(r) : fmtKes(r[c.key] as number)}
                          </td>
                        ))}
                        <td style={{ minWidth: 140 }}><AgingBar aging={r.aging} compact /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {report.expensesByCategory.length > 0 && (
            <div className="card">
              <div className="card-head"><span className="card-title">Expenses by category</span><span className="text-sm strong">{fmtKes(report.totals.expenses)}</span></div>
              <div className="card-pad col" style={{ gap: 10 }}>
                {report.expensesByCategory.map((c) => (
                  <div key={c.category} className="rn-cat">
                    <span>{c.category}</span>
                    <span className="rn-cat-bar"><i style={{ width: `${(c.amount / report.expensesByCategory[0]!.amount) * 100}%` }} /></span>
                    <b className="mono">{fmtKes(c.amount)}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
