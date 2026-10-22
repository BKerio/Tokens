import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Receipt } from 'lucide-react';
import { listTransactions } from '@/api/meters';
import { listPayments } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { downloadBlob } from '@/lib/downloadBlob';
import { fmtDateTime, fmtDateTimeFull } from '@/lib/datetime';
import { fmtKes, fmtToken, humanize, statusPill } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import { EmptyState, LoadingBlock, PageHeader, Pagination } from '@/components/shared/ui';
import TokenList from '@/components/public/TokenList';
import { ADMIN_ROLES, TOKEN_TYPE_LABELS, type PaymentChannel, type PaymentStatus, type TokenTransaction, type TokenType, type TransactionStatus } from '@/types/api';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function TokenTransactionsTab() {
  const user = useAuthStore((s) => s.user);
  const [params] = useSearchParams();
  const isCustomer = user?.role === 'CUSTOMER';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TransactionStatus | ''>((params.get('status') as TransactionStatus) ?? '');
  const [tokenType, setTokenType] = useState<TokenType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<TokenTransaction | null>(null);

  const filters = {
    search: search || undefined,
    status: status || undefined,
    tokenType: tokenType || undefined,
    from: from ? new Date(`${from}T00:00:00+03:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59+03:00`).toISOString() : undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page, filters],
    queryFn: () => listTransactions({ page, limit: 20, ...filters }),
    placeholderData: keepPreviousData,
  });

  const exportCsv = async () => {
    try {
      const rows = (await listTransactions({ page: 1, limit: 200, ...filters })).data;
      const header = ['Date', 'Meter', 'Owner', 'Customer', 'Type', 'Amount', 'Units', 'Tokens', 'Status', 'Channel', 'Receipt', 'Description'];
      const lines = rows.map((t) => [
        fmtDateTimeFull(t.createdAt), t.meter?.meterNumber ?? t.meterNumberSnapshot, t.vendor?.businessName ?? t.landlord?.fullName,
        t.customer?.name, TOKEN_TYPE_LABELS[t.tokenType], t.amount, t.units, t.tokens.join(' | '), t.status,
        t.payment?.channel ?? 'MANUAL', t.payment?.mpesaReceiptNumber, t.description,
      ].map(csvCell).join(','));
      downloadBlob(new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' }), `tokenpap-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      notify('error', 'Export failed', errorMessage(err));
    }
  };

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="card">
      <div className="card-pad flex gap-2 flex-wrap items-end" style={{ borderBottom: '1px solid var(--border)' }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Meter, phone or receipt" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
        <select className="eoc-select" value={status} onChange={(e) => reset(() => setStatus(e.target.value as TransactionStatus | ''))}>
          <option value="">All statuses</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
        </select>
        {!isCustomer && (
          <select className="eoc-select" value={tokenType} onChange={(e) => reset(() => setTokenType(e.target.value as TokenType | ''))}>
            <option value="">All token types</option>
            {Object.entries(TOKEN_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
        <input className="input" type="date" style={{ maxWidth: 160 }} value={from} onChange={(e) => reset(() => setFrom(e.target.value))} title="From" />
        <input className="input" type="date" style={{ maxWidth: 160 }} value={to} onChange={(e) => reset(() => setTo(e.target.value))} title="To" />
        <div style={{ flex: 1 }} />
        {data && <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Credit total: {fmtKes(data.meta.totalAmount)}</span>}
        {!isCustomer && <button className="btn btn-ghost btn-sm" onClick={exportCsv}><Download size={14} /> CSV</button>}
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : !data?.data.length ? (
        <EmptyState icon={<Receipt size={28} />} title="No transactions found" />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>{['Date', 'Meter', ...(isCustomer ? [] : ['Owner', 'Customer']), 'Type', 'Amount', 'Token', 'Source', 'Status'].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id} onClick={() => setOpen(t)}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(t.createdAt)}</td>
                  <td className="strong mono">{t.meter?.meterNumber ?? t.meterNumberSnapshot ?? '-'}</td>
                  {!isCustomer && <td>{t.vendor?.businessName ?? t.landlord?.fullName ?? '-'}</td>}
                  {!isCustomer && <td>{t.customer?.name ?? '-'}</td>}
                  <td>{TOKEN_TYPE_LABELS[t.tokenType]}</td>
                  <td>{t.amount ? fmtKes(t.amount) : '-'}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{t.tokens[0] ? fmtToken(t.tokens[0]) : '-'}</td>
                  <td>{t.payment ? humanize(t.payment.channel) : t.actorUser ? `Manual · ${t.actorUser.name}` : 'Manual'}</td>
                  <td><span className={statusPill(t.status)}>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={data?.meta} onPage={setPage} />

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }} onClick={() => setOpen(null)}>
          <div className="card w-full card-pad col" style={{ maxWidth: 520, gap: 12 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <span className="card-title">{TOKEN_TYPE_LABELS[open.tokenType]} · <span className="mono">{open.meter?.meterNumber ?? open.meterNumberSnapshot}</span></span>
              <span className={statusPill(open.status)}>{open.status}</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{fmtDateTimeFull(open.createdAt)}{open.amount ? ` · ${fmtKes(open.amount)}` : ''}{open.units ? ` · ${open.units} units` : ''}</p>
            {open.tokens.length > 0 && <TokenList tokens={open.tokens} />}
            <p className="text-sm" style={{ color: 'var(--ink)' }}>{open.description}</p>
            {open.payment?.mpesaReceiptNumber && <p className="text-sm" style={{ color: 'var(--muted)' }}>Receipt <b className="mono">{open.payment.mpesaReceiptNumber}</b></p>}
            {open.sendSms && <p className="text-sm" style={{ color: 'var(--muted)' }}>SMS to {open.phone}: {open.smsSent ? 'delivered' : 'not delivered'}</p>}
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }} onClick={() => setOpen(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [channel, setChannel] = useState<PaymentChannel | ''>('');
  const { data, isLoading } = useQuery({
    queryKey: ['payments', page, search, status, channel],
    queryFn: () => listPayments({ page, limit: 20, search: search || undefined, status: status || undefined, channel: channel || undefined }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="card">
      <div className="card-pad flex gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Account, phone or receipt" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="eoc-select" value={status} onChange={(e) => { setStatus(e.target.value as PaymentStatus | ''); setPage(1); }}>
          <option value="">All statuses</option>
          {['CONFIRMED', 'PENDING', 'FAILED'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <select className="eoc-select" value={channel} onChange={(e) => { setChannel(e.target.value as PaymentChannel | ''); setPage(1); }}>
          <option value="">All channels</option>
          <option value="STK">M-Pesa STK</option>
          <option value="C2B">C2B paybill</option>
          <option value="NCBA">NCBA paybill</option>
        </select>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : !data?.data.length ? (
        <EmptyState icon={<Receipt size={28} />} title="No payments found" />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{['Date', 'Channel', 'Account', 'Phone', 'Amount', 'Receipt', 'Token', 'Status'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.data.map((p) => {
                const tx = p.tokenTransactions[0];
                return (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(p.createdAt)}</td>
                    <td>{p.channel}</td>
                    <td className="mono">{p.accountReference ?? '-'}</td>
                    <td>{p.phone}</td>
                    <td>{fmtKes(p.amount)}</td>
                    <td className="mono">{p.mpesaReceiptNumber ?? '-'}</td>
                    <td>{tx ? <span className={statusPill(tx.status)}>{tx.status === 'SUCCESS' ? 'Issued' : 'Failed'}</span> : <span className="pill pill-gray">None</span>}</td>
                    <td><span className={statusPill(p.status)} title={p.resultDesc ?? undefined}>{p.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={data?.meta} onPage={setPage} />
    </div>
  );
}

function TransactionsPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const [tab, setTab] = useState<'tokens' | 'payments'>('tokens');
  const title = user?.role === 'CUSTOMER' ? 'Purchase history' : isAdmin ? 'Transactions' : 'Sales';

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader eyebrow="Ledger" title={title} subtitle={isAdmin ? 'Every token issued and every payment received.' : 'Every token issued for your meters.'} />
      {isAdmin && (
        <div className="tabs">
          <button className={`tab${tab === 'tokens' ? ' on' : ''}`} onClick={() => setTab('tokens')}>Token transactions</button>
          <button className={`tab${tab === 'payments' ? ' on' : ''}`} onClick={() => setTab('payments')}>Payments</button>
        </div>
      )}
      {tab === 'tokens' ? <TokenTransactionsTab /> : <PaymentsTab />}
    </div>
  );
}

export default TransactionsPage;
