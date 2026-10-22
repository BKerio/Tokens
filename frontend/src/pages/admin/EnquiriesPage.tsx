import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, MessageSquare, Trash2 } from 'lucide-react';
import { deleteEnquiry, listEnquiries, updateEnquiryStatus } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { fmtDateTime } from '@/lib/datetime';
import { humanize, statusPill } from '@/lib/format';
import { Drawer, EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput } from '@/components/shared/ui';
import type { Enquiry, EnquiryStatus } from '@/types/api';

function EnquiriesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EnquiryStatus | ''>('PENDING');
  const [open, setOpen] = useState<Enquiry | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['enquiries', page, search, status],
    queryFn: () => listEnquiries({ page, limit: 20, search: search || undefined, status: status || undefined }),
    placeholderData: keepPreviousData,
  });

  const setEnquiryStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: EnquiryStatus }) => updateEnquiryStatus(id, s),
    onSuccess: (e) => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      setOpen(e);
    },
    onError: (err) => notify('error', 'Update failed', errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: deleteEnquiry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      setOpen(null);
      notify('success', 'Enquiry deleted');
    },
    onError: (err) => notify('error', 'Delete failed', errorMessage(err)),
  });

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader eyebrow="Inbox" title="Public enquiries" subtitle="Meter installation requests from the website." />
      <div className="card">
        <div className="card-pad flex gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, email, phone, city…" />
          <select className="eoc-select" value={status} onChange={(e) => { setStatus(e.target.value as EnquiryStatus | ''); setPage(1); }}>
            <option value="">All</option><option value="PENDING">Pending</option><option value="REVIEWED">Reviewed</option><option value="ARCHIVED">Archived</option>
          </select>
        </div>
        {isLoading ? <LoadingBlock /> : !data?.data.length ? (
          <EmptyState icon={<MessageSquare size={28} />} title="No enquiries" />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{['Received', 'Name', 'Contact', 'City', 'Needs', 'Status'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {data.data.map((e) => (
                  <tr key={e.id} onClick={() => setOpen(e)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                    <td className="strong">{e.firstName} {e.lastName}</td>
                    <td>{e.phone}<br /><span className="text-xs" style={{ color: 'var(--muted)' }}>{e.email}</span></td>
                    <td>{e.city}</td>
                    <td>{e.meterTypes.join(', ')}</td>
                    <td><span className={statusPill(e.status)}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>

      {open && (
        <Drawer title={`${open.firstName} ${open.lastName}`} onClose={() => setOpen(null)}>
          <span className={statusPill(open.status)} style={{ alignSelf: 'flex-start' }}>{open.status}</span>
          {[
            ['Email', open.email], ['Phone', open.phone], ['City', open.city], ['Premises', open.premisesType],
            ['Property type', open.residenceType], ['Meters needed', open.meterTypes.join(', ')], ['Current main meter', open.mainMeterType],
            ['Received', fmtDateTime(open.createdAt)],
          ].map(([l, v]) => (
            <div key={l} className="flex justify-between gap-2 text-sm"><span style={{ color: 'var(--muted)' }}>{l}</span><span style={{ color: 'var(--ink)', textAlign: 'right' }}>{v}</span></div>
          ))}
          <p className="eyebrow">Message</p>
          <p className="text-sm" style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{open.message}</p>
          <div className="flex gap-2 flex-wrap">
            {open.status !== 'REVIEWED' && <button className="btn btn-primary btn-sm" onClick={() => setEnquiryStatus.mutate({ id: open.id, s: 'REVIEWED' })}><Check size={14} /> Mark reviewed</button>}
            {open.status !== 'ARCHIVED' && <button className="btn btn-ghost btn-sm" onClick={() => setEnquiryStatus.mutate({ id: open.id, s: 'ARCHIVED' })}><Archive size={14} /> Archive</button>}
            {open.status !== 'PENDING' && <button className="btn btn-ghost btn-sm" onClick={() => setEnquiryStatus.mutate({ id: open.id, s: 'PENDING' })}>Move to {humanize('PENDING')}</button>}
            <button className="btn btn-ghost btn-sm" onClick={async () => {
              if (await confirmDialog({ title: 'Delete this enquiry?', subject: { name: `${open.firstName} ${open.lastName}`, detail: open.email, icon: 'mail' }, removes: ['The message and its details'], irreversible: true, confirmLabel: 'Delete enquiry', danger: true })) remove.mutate(open.id);
            }}><Trash2 size={14} /> Delete</button>
          </div>
        </Drawer>
      )}
    </div>
  );
}

export default EnquiriesPage;
