import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Gauge, Receipt, ShoppingCart, TrendingUp } from 'lucide-react';
import { getMe } from '@/api/auth';
import { fmtDateTime } from '@/lib/datetime';
import { fmtKes, humanize, statusPill } from '@/lib/format';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/shared/ui';
import TokenList from '@/components/public/TokenList';
import BuyTokensPanel from '@/components/public/BuyTokensPanel';
import type { CustomerProfile } from '@/types/api';

export function useCustomerProfile() {
  return useQuery({ queryKey: ['me'], queryFn: async () => (await getMe()) as CustomerProfile });
}

function CustomerDashboard() {
  const navigate = useNavigate();
  const { data: me, isLoading } = useCustomerProfile();
  if (isLoading || !me) return <LoadingBlock height={360} />;

  const latest = me.recentTransactions.find((t) => t.status === 'SUCCESS' && t.tokens.length);

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow={me.vendor?.businessName ?? 'Customer'}
        title={`Hello, ${me.name.split(' ')[0]}`}
        subtitle={me.meter ? `Meter ${me.meter.meterNumber}` : 'No meter linked to your account yet.'}
        actions={<button className="btn btn-primary" onClick={() => navigate('/customer/buy')}><ShoppingCart size={16} /> Buy tokens</button>}
      />

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-ico"><Gauge /></div>
          <div className="stat-label">My meter</div>
          <div className="stat-val mono" style={{ fontSize: 20 }}>{me.meter?.meterNumber ?? '-'}</div>
          <div className="stat-foot">{me.meter ? `${humanize(me.meter.type)} · ${humanize(me.meter.status)}` : 'Ask your vendor to link a meter'}</div>
        </div>
        <div className="stat">
          <div className="stat-ico"><TrendingUp /></div>
          <div className="stat-label">Total spent</div>
          <div className="stat-val">{fmtKes(me.totalSpent)}</div>
          <div className="stat-foot">Across all token purchases</div>
        </div>
        <button className="stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/transactions')}>
          <div className="stat-ico"><Receipt /></div>
          <div className="stat-label">Purchases</div>
          <div className="stat-val">{me.recentTransactions.length}</div>
          <div className="stat-foot">View full history</div>
        </button>
      </div>

      {latest && (
        <div className="card">
          <div className="card-head">
            <span className="card-title">Latest token</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{fmtDateTime(latest.createdAt)}{latest.amount ? ` · ${fmtKes(latest.amount)}` : ''}</span>
          </div>
          <div className="card-pad"><TokenList tokens={latest.tokens} /></div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><span className="card-title">Recent purchases</span></div>
        {me.recentTransactions.length === 0 ? (
          <EmptyState icon={<Receipt size={28} />} title="No purchases yet" hint="Buy tokens with M-Pesa and they'll appear here." />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{['Date', 'Amount', 'Token', 'Status'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {me.recentTransactions.slice(0, 8).map((t) => (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(t.createdAt)}</td>
                    <td>{t.amount ? fmtKes(t.amount) : '-'}</td>
                    <td className="mono">{t.tokens[0] ?? '-'}</td>
                    <td><span className={statusPill(t.status)}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function CustomerBuyPage() {
  const { data: me, isLoading } = useCustomerProfile();
  if (isLoading || !me) return <LoadingBlock height={300} />;
  return (
    <div className="col" style={{ gap: 20, maxWidth: 560 }}>
      <PageHeader eyebrow="Lipa na M-Pesa" title="Buy tokens" subtitle="Pay with M-Pesa - your token appears here and arrives by SMS." />
      <div className="card"><BuyTokensPanel defaultMeter={me.meter?.meterNumber ?? ''} defaultPhone={me.phone} /></div>
    </div>
  );
}

export default CustomerDashboard;
