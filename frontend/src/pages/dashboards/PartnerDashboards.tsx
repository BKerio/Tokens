import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Gauge, DoorOpen, Home, TrendingUp, Users, Zap } from 'lucide-react';
import { getLandlordDashboard, getVendorProfile } from '@/api/accounts';
import { listTransactions } from '@/api/meters';
import { fmtDateTime } from '@/lib/datetime';
import { fmtKes, fmtKesShort, humanize, statusPill } from '@/lib/format';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/shared/ui';

/** Latest five vends for the signed-in partner (the API scopes to their meters). */
function RecentSales() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['transactions', 'recent'], queryFn: () => listTransactions({ page: 1, limit: 5 }) });

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">Recent sales</span>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/transactions')}>View all <ArrowRight size={14} /></button>
      </div>
      {isLoading ? (
        <LoadingBlock height={140} />
      ) : !data?.data.length ? (
        <EmptyState icon={<Zap size={28} />} title="No sales yet" hint="Tokens vended for your meters will show up here." />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{['Meter', 'Type', 'Amount', 'Status', 'When'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id}>
                  <td className="strong mono">{t.meter?.meterNumber ?? t.meterNumberSnapshot ?? '-'}</td>
                  <td>{humanize(t.tokenType)}</td>
                  <td>{t.amount ? fmtKes(t.amount) : '-'}</td>
                  <td><span className={statusPill(t.status)}>{t.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function VendorDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['vendor-profile'], queryFn: getVendorProfile });
  if (isLoading || !data) return <LoadingBlock height={360} />;
  const { vendor, stats } = data;

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow={vendor.vendorType === 'COMPANY' ? 'Company vendor' : 'Individual vendor'}
        title={vendor.businessName}
        subtitle={vendor.dashboardSettings?.tagline || `Account ${vendor.accountId}${vendor.paybill ? ` · Paybill ${vendor.paybill}` : ''}`}
        actions={<button className="btn btn-primary" onClick={() => navigate('/tokens')}><Zap size={16} /> Vend a token</button>}
      />
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-ico"><TrendingUp /></div>
          <div className="stat-label">Total sales</div>
          <div className="stat-val">{fmtKesShort(stats.totalSales)}</div>
          <div className="stat-foot">{stats.salesCount} credit vend(s)</div>
        </div>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/meters')}>
          <div className="stat-ico"><Gauge /></div>
          <div className="stat-label">My meters</div>
          <div className="stat-val">{stats.totalMeters}</div>
          <div className="stat-foot">{stats.activeMeters} active</div>
        </button>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/customers')}>
          <div className="stat-ico"><Users /></div>
          <div className="stat-label">Customers</div>
          <div className="stat-val">{stats.totalCustomers}</div>
          <div className="stat-foot">Onboarded to your meters</div>
        </button>
      </div>
      <RecentSales />
    </div>
  );
}

export function LandlordDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['landlord-dashboard'], queryFn: getLandlordDashboard });
  if (isLoading || !data) return <LoadingBlock height={360} />;
  const { landlord, summary, sales } = data;

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Landlord"
        title={landlord.fullName}
        subtitle={`Payments to ${landlord.paymentAccount} · ${landlord.phone}`}
        actions={<button className="btn btn-primary" onClick={() => navigate('/tokens')}><Zap size={16} /> Vend a token</button>}
      />
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-ico"><TrendingUp /></div>
          <div className="stat-label">Total sales</div>
          <div className="stat-val">{fmtKesShort(sales.total)}</div>
          <div className="stat-foot">{sales.count} credit vend(s)</div>
        </div>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/landlord/properties')}>
          <div className="stat-ico"><Home /></div>
          <div className="stat-label">Properties</div>
          <div className="stat-val">{summary.properties}</div>
          <div className="stat-foot">{summary.units} unit(s) · {summary.tenants} tenant(s)</div>
        </button>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/landlord/units')}>
          <div className="stat-ico"><DoorOpen /></div>
          <div className="stat-label">Units</div>
          <div className="stat-val">{summary.units}</div>
          <div className="stat-foot">{summary.occupied} let · {summary.vacant} vacant</div>
        </button>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/meters')}>
          <div className="stat-ico"><Gauge /></div>
          <div className="stat-label">Assigned meters</div>
          <div className="stat-val">{summary.meters}</div>
          <div className="stat-foot">Assigned by TokenPap admins</div>
        </button>
      </div>
      <RecentSales />
    </div>
  );
}
