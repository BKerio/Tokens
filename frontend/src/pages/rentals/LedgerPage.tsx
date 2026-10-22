import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookText, Receipt, Undo2 } from 'lucide-react';
import { listLedger, reverseEntry } from '@/api/rentals';
import { listProperties } from '@/api/properties';
import { errorMessage } from '@/api/client';
import { notify, promptDialog } from '@/lib/alert';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput } from '@/components/shared/ui';
import type { LedgerEntryType } from '@/types/api';
import { Amount, METHOD_LABEL, TYPE_LABEL, TYPE_PILL, fmtDay } from './rentUi';
import { MoneyModal } from './MoneyModal';

/** Every money entry, newest first. Entries are never edited - mistakes are reversed. */
export default function LedgerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useLandlordAccess();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<LedgerEntryType | ''>('');
  const [propertyId, setPropertyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expense, setExpense] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['ledger', page, search, type, propertyId, from, to],
    queryFn: () => listLedger({ page, limit: 25, search: search || undefined, type: type || undefined, propertyId: propertyId || undefined, from: from || undefined, to: to || undefined }),
    placeholderData: keepPreviousData,
  });
  const { data: properties = [] } = useQuery({ queryKey: ['properties', ''], queryFn: () => listProperties() });

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => reverseEntry(id, reason),
    onSuccess: () => {
      for (const key of [['ledger'], ['leases'], ['lease'], ['statement'], ['arrears'], ['rent-report']]) queryClient.invalidateQueries({ queryKey: key });
      notify('success', 'Entry reversed');
    },
    onError: (err) => notify('error', 'Could not reverse', errorMessage(err)),
  });
  const askReverse = async (id: string, label: string) => {
    const reason = await promptDialog({ title: `Reverse this ${label}?`, text: 'A matching negative entry is posted and the original stays on record.', inputLabel: 'Reason', confirmLabel: 'Reverse', minLength: 3 });
    if (reason) reverse.mutate({ id, reason });
  };

  const reset = () => setPage(1);

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Rentals"
        title="Ledger"
        subtitle="Rent charges, payments, deposits, credits and expenses. Append-only: corrections are posted as reversals."
        actions={can('expenses.manage') && <button className="btn btn-primary" onClick={() => setExpense(true)}><Receipt size={16} /> Record expense</button>}
      />

      <div className="card">
        <div className="card-pad flex gap-2 flex-wrap items-end" style={{ borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Tenant, lease code, receipt or note…" />
          <select className="eoc-select" style={{ maxWidth: 180 }} value={type} onChange={(e) => { setType(e.target.value as LedgerEntryType | ''); reset(); }}>
            <option value="">All entries</option>
            {(Object.keys(TYPE_LABEL) as LedgerEntryType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <select className="eoc-select" style={{ maxWidth: 200 }} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); reset(); }}>
            <option value="">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="input" type="date" style={{ maxWidth: 160 }} aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
          <input className="input" type="date" style={{ maxWidth: 160 }} aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
        </div>

        {isLoading ? <LoadingBlock /> : !data?.data.length ? (
          <EmptyState icon={<BookText size={28} />} title="No entries" hint="Rent charges appear here automatically once leases are created." />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl rn-table">
              <thead><tr>{['Date', 'Entry', 'Tenant / lease', 'Property', 'Method', 'Amount', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {data.data.map((e) => (
                  <tr key={e.id} className={e.reversed || e.reversalOfId ? 'rn-struck' : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(e.entryDate)}</td>
                    <td>
                      <span className={TYPE_PILL[e.type]}>{TYPE_LABEL[e.type]}</span>
                      {e.reversalOfId && <span className="pill pill-gray" style={{ marginLeft: 4 }}>Reversal</span>}
                      {e.reversed && <span className="pill pill-gray" style={{ marginLeft: 4 }}>Reversed</span>}
                      <small className="rn-sub">{e.description ?? e.category ?? ''}</small>
                    </td>
                    <td>
                      {e.lease ? (
                        <button type="button" className="rn-link" onClick={() => navigate(`/landlord/leases?lease=${e.lease!.id}&tab=ALL`)}>
                          {e.tenant?.name ?? 'Tenant'} <span className="mono">{e.lease.code}</span>
                        </button>
                      ) : <span className="rn-muted">{e.category ?? '-'}</span>}
                    </td>
                    <td>{e.property?.name}{e.unit ? <small className="rn-sub">{e.unit.name}</small> : null}</td>
                    <td>{e.method ? METHOD_LABEL[e.method] : '-'}{e.reference ? <small className="rn-sub mono">{e.reference}</small> : null}</td>
                    <td style={{ textAlign: 'right' }}><Amount value={e.amount} type={e.type} /></td>
                    <td>{can('entries.reverse') && !e.reversed && !e.reversalOfId && (
                      <button className="icon-btn" title="Reverse" onClick={() => askReverse(e.id, TYPE_LABEL[e.type].toLowerCase())}><Undo2 size={13} /></button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>

      {expense && <MoneyModal kind="expense" onClose={() => setExpense(false)} />}
    </div>
  );
}
