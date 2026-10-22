import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Building2, CalendarDays, ChevronRight, CircleAlert, Download, Gauge, Home, MessageSquare,
  ShieldCheck, TrendingUp, Users, Zap, type LucideIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAdminStats } from '@/api/admin';
import { fmtKes, fmtKesShort, humanize } from '@/lib/format';
import { downloadBlob } from '@/lib/downloadBlob';
import { EmptyState, LoadingBlock } from '@/components/shared/ui';
import type { AdminStats } from '@/types/api';

type Day = AdminStats['dailySales'][number];

const sum = (days: Day[], f: (d: Day) => number) => days.reduce((n, d) => n + f(d), 0);
const rate = (ok: number, failed: number) => (ok + failed ? (ok / (ok + failed)) * 100 : null);
/** % change, or null when there is nothing to compare against. */
const change = (now: number, before: number) => (before ? ((now - before) / before) * 100 : null);

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', opts);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Trend({ value, unit = '%', suffix = 'vs last week' }: { value: number | null; unit?: string; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="hd-trend flat">No data last week</span>;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`hd-trend ${up ? 'up' : 'down'}`}>
      <Icon size={14} /> {up ? '+' : ''}{value.toFixed(1)}{unit} <em>{suffix}</em>
    </span>
  );
}

function Kpi({ Icon, label, value, sub, onClick }: { Icon: LucideIcon; label: string; value: ReactNode; sub: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`hd-card hd-kpi${onClick ? ' clickable' : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="hd-kpi-head"><span className="hd-ico"><Icon size={16} /></span>{label}</span>
      <b className="hd-kpi-value">{value}</b>
      {sub}
    </Tag>
  );
}

function CardHead({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="hd-card-head"><b>{title}</b>{action}</div>;
}

/** Semi-circle gauge: today's vends against the best day of the last 30. */
function TodayGauge({ value, max }: { value: number; max: number }) {
  const r = 78;
  const len = Math.PI * r;
  const frac = Math.min(1, max ? value / max : 0);
  return (
    <svg viewBox="0 0 200 112" className="hd-gauge" role="img" aria-label={`${value} vends today`}>
      <defs>
        <linearGradient id="hd-gauge-grad" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--green)" />
          <stop offset="100%" stopColor="#5FA8F5" />
        </linearGradient>
      </defs>
      <path d={`M 22 100 A ${r} ${r} 0 0 1 178 100`} fill="none" stroke="var(--surface-3)" strokeWidth={16} strokeLinecap="round" />
      <path
        d={`M 22 100 A ${r} ${r} 0 0 1 178 100`}
        fill="none"
        stroke="url(#hd-gauge-grad)"
        strokeWidth={16}
        strokeLinecap="round"
        strokeDasharray={`${len * frac} ${len}`}
        style={{ transition: 'stroke-dasharray .8s cubic-bezier(.16,1,.3,1)' }}
      />
      <text x="100" y="86" textAnchor="middle" className="hd-gauge-num">{value}</text>
      <text x="100" y="104" textAnchor="middle" className="hd-gauge-cap">vends today</text>
    </svg>
  );
}

function downloadCsv(stats: AdminStats) {
  const rows = [['date', 'sales_kes', 'successful_vends', 'failed_vends'], ...stats.dailySales.map((d) => [d.date, d.amount.toFixed(2), d.count, d.failed])];
  const csv = rows.map((r) => r.join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `tokenpap-sales-${stats.dailySales[0]?.date}-to-${stats.dailySales[stats.dailySales.length - 1]?.date}.csv`);
}

function AdminDashboard() {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useQuery({ queryKey: ['admin-stats'], queryFn: getAdminStats, refetchInterval: 60_000 });
  const [pickedDay, setPickedDay] = useState(() => isoDay(new Date()));

  const m = useMemo(() => {
    if (!stats) return null;
    const days = stats.dailySales;
    const last7 = days.slice(-7);
    const prev7 = days.slice(-14, -7);
    const ok30 = sum(days, (d) => d.count);
    const failed30 = sum(days, (d) => d.failed);
    const rateNow = rate(sum(last7, (d) => d.count), sum(last7, (d) => d.failed));
    const ratePrev = rate(sum(prev7, (d) => d.count), sum(prev7, (d) => d.failed));
    const chart = days.slice(-14);
    const ok14 = sum(chart, (d) => d.count);
    const failed14 = sum(chart, (d) => d.failed);
    return {
      revenue30: sum(days, (d) => d.amount),
      revenueTrend: change(sum(last7, (d) => d.amount), sum(prev7, (d) => d.amount)),
      vends30: ok30,
      vendsTrend: change(sum(last7, (d) => d.count), sum(prev7, (d) => d.count)),
      success30: rate(ok30, failed30),
      successTrend: rateNow !== null && ratePrev !== null ? rateNow - ratePrev : null,
      bestDay: Math.max(1, ...days.map((d) => d.count)),
      chart: chart.map((d) => ({ ...d, label: fmtDay(d.date, { day: 'numeric', month: 'short' }) })),
      ok14,
      failed14,
      byDate: new Map(days.map((d) => [d.date, d])),
    };
  }, [stats]);

  if (isLoading || !stats || !m) return <LoadingBlock height={480} />;

  const { meters, vendors } = stats;
  const meterPct = (n: number) => (meters.total ? (n / meters.total) * 100 : 0);
  const share14 = (n: number) => (m.ok14 + m.failed14 ? Math.round((n / (m.ok14 + m.failed14)) * 100) : 0);

  // Monday-first week strip around today.
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  const picked = m.byDate.get(pickedDay);

  const attention = [
    vendors.pending > 0 && { Icon: Building2, text: `${vendors.pending} vendor registration${vendors.pending === 1 ? '' : 's'} awaiting approval`, to: '/vendors?tab=pending' },
    stats.pendingEnquiries > 0 && { Icon: MessageSquare, text: `${stats.pendingEnquiries} new enquir${stats.pendingEnquiries === 1 ? 'y' : 'ies'}`, to: '/enquiries' },
    stats.vending.failedLast30Days > 0 && { Icon: Zap, text: `${stats.vending.failedLast30Days} failed vend${stats.vending.failedLast30Days === 1 ? '' : 's'} in 30 days`, to: '/transactions?status=FAILED' },
    meters.maintenance > 0 && { Icon: Gauge, text: `${meters.maintenance} meter${meters.maintenance === 1 ? '' : 's'} in maintenance`, to: '/meters' },
  ].filter(Boolean) as { Icon: LucideIcon; text: string; to: string }[];

  return (
    <div className="hd">
      <header className="hd-top">
        <h2>Dashboard</h2>
        <div className="hd-top-actions">
          <span className="hd-range"><CalendarDays size={15} /> {fmtDay(stats.dailySales[0]!.date)} - {fmtDay(stats.dailySales[stats.dailySales.length - 1]!.date)}</span>
          <button type="button" className="hd-icon-btn dark" onClick={() => downloadCsv(stats)} title="Download daily sales (CSV)" aria-label="Download daily sales as CSV">
            <Download size={16} />
          </button>
        </div>
      </header>

      {/* KPIs */}
      <div className="hd-kpis">
        <Kpi Icon={TrendingUp} label="Revenue (30 days)" value={fmtKesShort(m.revenue30)} sub={<Trend value={m.revenueTrend} />} onClick={() => navigate('/transactions')} />
        <Kpi Icon={Zap} label="Tokens vended" value={m.vends30.toLocaleString()} sub={<Trend value={m.vendsTrend} />} onClick={() => navigate('/transactions')} />
        <Kpi
          Icon={ShieldCheck}
          label="Vend success rate"
          value={m.success30 === null ? '-' : <>{m.success30.toFixed(1)}<small>%</small></>}
          sub={<Trend value={m.successTrend} unit=" pts" />}
        />
        <Kpi
          Icon={Gauge}
          label="Active meters"
          value={<>{meters.active}<small>/{meters.total}</small></>}
          sub={<span className="hd-trend flat">{meters.maintenance} in maintenance · {meters.inactive} inactive</span>}
          onClick={() => navigate('/meters')}
        />
      </div>

      {/* Mid row */}
      <div className="hd-row3">
        <section className="hd-card">
          <CardHead title="Partners" action={<button type="button" className="hd-more" onClick={() => navigate('/vendors')} aria-label="Open vendors"><ArrowRight size={15} /></button>} />
          <div className="hd-split">
            <button type="button" className="hd-tile green" onClick={() => navigate('/vendors')}>
              <b>{vendors.total}</b>
              <span className="hd-chip">{vendors.active} active</span>
              <span className="hd-tile-label">Vendors</span>
            </button>
            <button type="button" className="hd-tile amber" onClick={() => navigate('/landlords')}>
              <b>{stats.landlords}</b>
              <span className="hd-chip">{stats.customers} customers</span>
              <span className="hd-tile-label">Landlords</span>
            </button>
          </div>
        </section>

        <section className="hd-card">
          <CardHead title="Meter health" />
          <div className="hd-health">
            <b className="hd-big">{meters.total ? meterPct(meters.active).toFixed(1) : '0'}<small>%</small></b>
            <span className="hd-trend flat">of {meters.total} meters active</span>
          </div>
          <div className="hd-segbar" aria-hidden="true">
            <i className="a" style={{ flexGrow: meters.active || 0.0001 }} />
            <i className="m" style={{ flexGrow: meters.maintenance || 0.0001 }} />
            <i className="x" style={{ flexGrow: meters.inactive || 0.0001 }} />
          </div>
          <ul className="hd-legend">
            <li><i className="a" /> Active <b>{meters.active}</b></li>
            <li><i className="m" /> Maintenance <b>{meters.maintenance}</b></li>
            <li><i className="x" /> Inactive <b>{meters.inactive}</b></li>
          </ul>
        </section>

        <section className="hd-card">
          <CardHead title="Today" />
          <div className="hd-today">
            <TodayGauge value={stats.vending.todayCount} max={Math.max(m.bestDay, stats.vending.todayCount)} />
            <ul className="hd-today-list">
              <li><i className="a" /><b>{fmtKesShort(stats.vending.todayRevenue)}</b> revenue</li>
              <li><i className="m" /><b>{m.bestDay}</b> best day (30d)</li>
              <li><i className="x" /><b>{stats.vending.tokensIssued}</b> all-time tokens</li>
            </ul>
          </div>
        </section>
      </div>

      {/* Chart + calendar */}
      <div className="hd-row2">
        <section className="hd-card">
          <CardHead title="Vending overview" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/transactions')}>See detail</button>} />
          <div className="hd-chart-meta">
            <div>
              <b>{m.success30 === null ? '-' : `${m.success30.toFixed(1)}%`}</b>
              {m.successTrend !== null && <span className={`hd-pill ${m.successTrend >= 0 ? 'up' : 'down'}`}>{m.successTrend >= 0 ? '+' : ''}{m.successTrend.toFixed(1)} pts</span>}
              <small>Success rate</small>
            </div>
            <div>
              <b>{m.ok14 + m.failed14}<em>/{m.vends30 + sum(stats.dailySales, (d) => d.failed)}</em></b>
              <small>Vends in 14 days / 30 days</small>
            </div>
            <ul className="hd-chart-legend">
              <li><i className="ok" /> Successful <b>{share14(m.ok14)}%</b></li>
              <li><i className="bad" /> Failed <b>{share14(m.failed14)}%</b></li>
            </ul>
          </div>
          <div className="hd-chart">
            {m.ok14 + m.failed14 === 0 ? (
              <EmptyState icon={<Zap size={26} />} title="No vends in the last 14 days" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.chart} margin={{ top: 6, right: 4, left: -18, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={1} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-3)', radius: 6 }}
                    contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', fontSize: 12 }}
                    formatter={(v: number, name: string) => [v, name === 'count' ? 'Successful' : 'Failed']}
                  />
                  <Bar dataKey="count" stackId="v" fill="var(--green)" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="failed" stackId="v" fill="#C8CFDC" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="hd-card">
          <CardHead title="This week" action={<span className="hd-ico"><CalendarDays size={15} /></span>} />
          <div className="hd-week" role="tablist" aria-label="Pick a day">
            {week.map((d) => {
              const key = isoDay(d);
              const data = m.byDate.get(key);
              const isToday = key === isoDay(today);
              const future = d > today;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={pickedDay === key}
                  disabled={future}
                  className={`hd-day${pickedDay === key ? ' on' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => setPickedDay(key)}
                >
                  <b>{d.getDate()}</b>
                  <small>{d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</small>
                  {data && data.count > 0 && <i aria-label="Has sales" />}
                </button>
              );
            })}
          </div>
          <div className="hd-day-summary">
            <span>{fmtDay(pickedDay, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
            <b>{picked ? `${picked.count} vend${picked.count === 1 ? '' : 's'} · ${fmtKes(picked.amount)}` : 'No data'}</b>
            {picked && picked.failed > 0 && <em>{picked.failed} failed</em>}
          </div>
          <div className="hd-activity">
            {stats.recentTransactions.length === 0 ? (
              <EmptyState title="No token activity yet" />
            ) : stats.recentTransactions.slice(0, 4).map((t) => (
              <button key={t.id} type="button" className="hd-event" onClick={() => navigate('/transactions')}>
                <span className={`hd-event-ico ${t.status === 'SUCCESS' ? 'ok' : 'bad'}`}><Zap size={15} /></span>
                <span className="hd-event-text">
                  <b>{t.amount ? fmtKes(t.amount) : humanize(t.tokenType)} · <span className="mono">{t.meterNumberSnapshot ?? '-'}</span></b>
                  <small>
                    {t.vendor?.businessName ?? t.landlord?.fullName ?? 'Unassigned'} · {new Date(t.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Bottom row */}
      <div className="hd-row2 even">
        <section className="hd-card">
          <CardHead title="Top vendors (30 days)" />
          {stats.topVendors.length === 0 ? (
            <EmptyState icon={<Building2 size={26} />} title="No vendor sales yet" />
          ) : (
            <ol className="hd-rank">
              {stats.topVendors.map((v, i) => {
                const max = stats.topVendors[0]!.amount || 1;
                return (
                  <li key={v.vendorId}>
                    <span className="hd-rank-n">{i + 1}</span>
                    <span className="hd-rank-body">
                      <span className="hd-rank-line"><b>{v.name}</b><em>{fmtKes(v.amount)}</em></span>
                      <span className="hd-rank-bar"><i style={{ width: `${(v.amount / max) * 100}%` }} /></span>
                      <small>{v.count} vend{v.count === 1 ? '' : 's'}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="hd-card">
          <CardHead title="Needs attention" action={attention.length > 0 && <span className="hd-pill down">{attention.length}</span>} />
          {attention.length === 0 ? (
            <div className="hd-allclear"><ShieldCheck size={28} /><b>All clear</b><small>No approvals, enquiries or failed vends waiting.</small></div>
          ) : (
            <div className="hd-activity">
              {attention.map(({ Icon, text, to }) => (
                <button key={text} type="button" className="hd-event" onClick={() => navigate(to)}>
                  <span className="hd-event-ico warn"><Icon size={15} /></span>
                  <span className="hd-event-text"><b>{text}</b><small>Review now</small></span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          )}
          <div className="hd-shortcuts">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/tokens')}><Zap size={14} /> Vend a token</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/customers')}><Users size={14} /> Customers</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/landlords')}><Home size={14} /> Landlords</button>
            {stats.vending.failedLast30Days > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/transactions?status=FAILED')}><CircleAlert size={14} /> Failed vends</button>}
          </div>
        </section>
      </div>
    </div>
  );
}

export default AdminDashboard;
