import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, FileSignature, HandCoins, MapPin, PiggyBank, Plus, Receipt, ShieldCheck, TrendingUp, Wallet } from 'lucide-react';
import { getRentReport, listArrears } from '@/api/rentals';
import { fmtKes, fmtKesShort } from '@/lib/format';
import { nairobiTodayISO } from '@/lib/datetime';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { EmptyState, LoadingBlock } from '@/components/shared/ui';
import LeaseFormModal from './LeaseFormModal';
import { AgingBar, fmtDay } from './rentUi';
import { MoneyModal } from './MoneyModal';

/** Landlord rent overview: this month's money, arrears and occupancy at a glance. */
export default function RentDashboardPage() {
  const navigate = useNavigate();
  const { access, can } = useLandlordAccess();
  const today = nairobiTodayISO();
  const monthStart = `${today.slice(0, 8)}01`;
  const [creating, setCreating] = useState(false);
  const [money, setMoney] = useState<'payment' | 'expense' | null>(null);

  const { data: report, isLoading } = useQuery({
    queryKey: ['rent-report', 'dashboard', monthStart, today],
    queryFn: () => getRentReport({ from: monthStart, to: today, groupBy: 'location' }),
    enabled: can('reports.view'),
  });
  const { data: arrears = [] } = useQuery({ queryKey: ['arrears', 8], queryFn: () => listArrears(8), enabled: can('ledger.view') });

  if (can('reports.view') && (isLoading || !report)) return <LoadingBlock height={480} />;
  const t = report?.totals;
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="hd">
      <header className="hd-top">
        <div>
          <h2>Rent overview</h2>
          <p className="rn-muted" style={{ margin: '4px 0 0' }}>{access?.landlordName ?? ''}{access && access.role !== 'OWNER' ? ` · signed in as ${access.role.toLowerCase()}` : ''}</p>
        </div>
        <div className="hd-top-actions">
          <span className="hd-range">{monthName} to date</span>
          {can('payments.record') && <button className="btn btn-ghost btn-sm" onClick={() => setMoney('payment')}><HandCoins size={14} /> Payment</button>}
          {can('expenses.manage') && <button className="btn btn-ghost btn-sm" onClick={() => setMoney('expense')}><Receipt size={14} /> Expense</button>}
          {can('leases.manage') && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> New lease</button>}
        </div>
      </header>

      {t && (
        <div className="hd-kpis rn-kpis">
          <button type="button" className="hd-card hd-kpi clickable" onClick={() => navigate('/landlord/leases')}>
            <span className="hd-kpi-head"><span className="hd-ico"><TrendingUp size={16} /></span>Rent roll</span>
            <b className="hd-kpi-value">{fmtKesShort(t.rentRoll)}<small>/mo</small></b>
            <span className="hd-trend flat">{t.occupied} active lease{t.occupied === 1 ? '' : 's'}</span>
          </button>
          <button type="button" className="hd-card hd-kpi clickable" onClick={() => navigate('/landlord/ledger')}>
            <span className="hd-kpi-head"><span className="hd-ico"><Wallet size={16} /></span>Collected this month</span>
            <b className="hd-kpi-value">{fmtKesShort(t.collected)}</b>
            <span className={`hd-trend ${t.collectionRate === null ? 'flat' : t.collectionRate >= 90 ? 'up' : 'down'}`}>
              {t.collectionRate === null ? 'Nothing billed yet' : <>{t.collectionRate.toFixed(0)}% of {fmtKesShort(t.billed)} billed</>}
            </span>
          </button>
          <button type="button" className="hd-card hd-kpi clickable" onClick={() => navigate('/landlord/leases?tab=ARREARS')}>
            <span className="hd-kpi-head"><span className="hd-ico"><ShieldCheck size={16} /></span>Arrears</span>
            <b className="hd-kpi-value" style={{ color: t.arrears > 0 ? 'var(--red)' : undefined }}>{fmtKesShort(t.arrears)}</b>
            <AgingBar aging={t.aging} compact />
          </button>
          <div className="hd-card hd-kpi">
            <span className="hd-kpi-head"><span className="hd-ico"><Building2 size={16} /></span>Occupancy</span>
            <b className="hd-kpi-value">{t.occupancyRate === null ? '-' : <>{t.occupancyRate.toFixed(0)}<small>%</small></>}</b>
            <span className="hd-trend flat">{t.occupied}/{t.units} units · {t.vacant} vacant</span>
          </div>
          <div className="hd-card hd-kpi">
            <span className="hd-kpi-head"><span className="hd-ico"><PiggyBank size={16} /></span>Deposits held</span>
            <b className="hd-kpi-value">{fmtKesShort(t.depositsHeld)}</b>
            <span className="hd-trend flat">Owed back to tenants, not income</span>
          </div>
        </div>
      )}

      <div className="hd-row2">
        <section className="hd-card">
          <div className="hd-card-head"><b>Biggest arrears</b>{arrears.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => navigate('/landlord/leases?tab=ARREARS')}>See all</button>}</div>
          {arrears.length === 0 ? (
            <div className="hd-allclear"><ShieldCheck size={28} /><b>Everyone is up to date</b><small>No overdue rent right now.</small></div>
          ) : (
            <div className="hd-activity">
              {arrears.map((r) => (
                <button key={r.id} type="button" className="hd-event" onClick={() => navigate(`/landlord/leases?tab=ALL&lease=${r.id}`)}>
                  <span className="hd-event-ico bad"><FileSignature size={15} /></span>
                  <span className="hd-event-text">
                    <b>{r.tenant.name} · {fmtKes(r.arrears)}</b>
                    <small>{r.unit.name}, {r.property.name}{r.oldestUnpaidDue ? ` · overdue since ${fmtDay(r.oldestUnpaidDue)}` : ''}{r.status !== 'ACTIVE' ? ' · former tenant' : ''}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="hd-card">
          <div className="hd-card-head"><b>By location</b>{can('reports.view') && <button className="btn btn-ghost btn-sm" onClick={() => navigate('/landlord/reports')}>Reports</button>}</div>
          {!report || report.rows.length === 0 ? (
            <EmptyState icon={<MapPin size={26} />} title="No properties yet" />
          ) : (
            <div className="rn-locs">
              {report.rows.map((r) => (
                <div key={r.id} className="rn-loc">
                  <span className="rn-loc-name"><MapPin size={14} /> {r.name}<small>{r.properties} propert{r.properties === 1 ? 'y' : 'ies'} · {r.occupied}/{r.units} let</small></span>
                  <span className="rn-loc-bar"><i style={{ width: `${r.occupancyRate ?? 0}%` }} /></span>
                  <span className="rn-loc-nums">
                    <span>Collected <b>{fmtKesShort(r.collected)}</b></span>
                    <span>Arrears <b style={{ color: r.arrears > 0 ? 'var(--red)' : undefined }}>{fmtKesShort(r.arrears)}</b></span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {creating && <LeaseFormModal onClose={() => setCreating(false)} onCreated={(l) => navigate(`/landlord/leases?lease=${l.id}`)} />}
      {money && <MoneyModal kind={money} onClose={() => setMoney(null)} />}
    </div>
  );
}
