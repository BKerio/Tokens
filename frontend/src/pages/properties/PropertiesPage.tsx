import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Home, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { deleteProperty, listProperties } from '@/api/properties';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { humanize, statusPill } from '@/lib/format';
import { EmptyState, LoadingBlock, PageHeader, SearchInput } from '@/components/shared/ui';
import type { Property } from '@/types/api';
import PropertyFormModal from './PropertyFormModal';

function PropertiesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { access, can } = useLandlordAccess();
  const portfolio = can('properties.manage') && access?.allProperties !== false;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Property | 'new' | null>(null);
  const { data: properties = [], isLoading } = useQuery({ queryKey: ['properties', search], queryFn: () => listProperties(search || undefined) });

  const remove = useMutation({
    mutationFn: deleteProperty,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      notify('success', 'Property deleted');
    },
    onError: (err) => notify('error', 'Delete failed', errorMessage(err)),
  });

  const onDelete = async (p: Property) => {
    if (await confirmDialog({ title: 'Delete property', text: `Delete ${p.name} with all its units and tenants?`, confirmLabel: 'Delete', danger: true })) remove.mutate(p.id);
  };

  const region = (p: Property) => [p.ward?.name, p.constituency?.name, p.county?.name].filter(Boolean).join(', ');

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Properties"
        title="My properties"
        subtitle="Buildings and estates you manage. Open one to set up its units, rent and payment accounts."
        actions={portfolio && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Add property</button>}
      />
      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or location…" />
        </div>
        {isLoading ? <LoadingBlock /> : properties.length === 0 ? (
          <EmptyState icon={<Home size={28} />} title="No properties yet" action={portfolio ? <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>Add your first property</button> : undefined} />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{['Property', 'Type', 'Location', 'Units', 'Let', 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {properties.map((p) => {
                  const where = region(p);
                  return (
                    <tr key={p.id} onClick={() => navigate(`/landlord/units?property=${p.id}`)}>
                      <td className="strong">{p.name}</td>
                      <td>{humanize(p.propertyType)}</td>
                      <td>
                        <span className="rn-strong">
                          {p.locationGroup && <span className="pill pill-blue" style={{ marginRight: 6 }}>{p.locationGroup.name}</span>}
                          {p.location}
                        </span>
                        {where && <span className="rn-sub"><MapPin size={11} style={{ verticalAlign: -1 }} /> {where}</span>}
                      </td>
                      <td>{p._count?.units ?? p.noOfUnits}</td>
                      <td>{p._count?.leases ?? 0} / {p._count?.units ?? 0}</td>
                      <td><span className={statusPill(p.status)}>{p.status}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" title="Units" onClick={() => navigate(`/landlord/units?property=${p.id}`)}><DoorOpen size={14} /></button>
                        {can('properties.manage') && <button className="icon-btn" title="Edit" onClick={() => setEditing(p)}><Pencil size={14} /></button>}
                        {portfolio && <button className="icon-btn" title="Delete" onClick={() => onDelete(p)}><Trash2 size={14} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <PropertyFormModal property={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export default PropertiesPage;
