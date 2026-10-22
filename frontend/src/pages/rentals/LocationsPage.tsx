import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { createLocation, deleteLocation, listLocations, setPropertyLocation, updateLocation } from '@/api/rentals';
import { listProperties } from '@/api/properties';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import { listCounties } from '@/api/meters';
import { FormSheet, SheetField, SheetGrid, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/shared/ui';
import type { PropertyLocation } from '@/types/api';

function LocationModal({ location, onClose }: { location?: PropertyLocation; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: counties = [] } = useQuery({ queryKey: ['counties'], queryFn: listCounties, staleTime: Infinity });
  const [name, setName] = useState(location?.name ?? '');
  const [county, setCounty] = useState(location?.county ?? '');
  const [description, setDescription] = useState(location?.description ?? '');
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const data = { name: name.trim(), county: county.trim() || undefined, description: description.trim() || undefined };
      return location ? updateLocation(location.id, data) : createLocation(data);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['locations'] }); notify('success', location ? 'Location updated' : 'Location added'); onClose(); },
    onError: (err) => notify('error', 'Could not save', errorMessage(err)),
  });
  const nameBad = name.trim().length < 2;
  const quick = ['Nairobi City', 'Nakuru', 'Mombasa', 'Kiambu', 'Kisumu'].filter((c) => counties.some((x) => x.name === c));
  return (
    <FormSheet
      icon={MapPin}
      title={location ? `Edit ${location.name}` : 'New location'}
      subtitle="A portfolio group such as Nairobi or Nakuru. Reports can be broken down by location."
      width={580}
      onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); setTried(true); if (!nameBad) save.mutate(); }}
      busy={save.isPending}
      submitLabel={location ? 'Save location' : 'Add location'}
      meta={<><MapPin size={15} /> <b>{name.trim() || 'Unnamed'}</b>{county && <> · {county}</>}</>}
    >
      <SheetSection id="location" title="Location" Icon={MapPin}>
        {!location && quick.length > 0 && (
          <div className="vf-field">
            <span className="vf-label">Quick add</span>
            <div className="vf-chips">
              {quick.map((c) => {
                const label = c.replace(' City', '');
                return (
                  <button key={c} type="button" className={`vf-chip${name === label ? ' on' : ''}`} onClick={() => { setName(label); setCounty(c); }}>
                    <i />{label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <SheetGrid>
          <SheetField label="Name" required error={tried && nameBad ? 'At least 2 characters' : undefined}>
            <input className="input" autoFocus placeholder="e.g. Nairobi" value={name} onChange={(e) => setName(e.target.value)} />
          </SheetField>
          <SheetField label="County" aside="Optional">
            <select className="eoc-select" value={county} onChange={(e) => setCounty(e.target.value)}>
              <option value="">No county</option>
              {county && !counties.some((c) => c.name === county) && <option value={county}>{county}</option>}
              {counties.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </SheetField>
        </SheetGrid>
        <SheetField label="Description" aside="Optional">
          <input className="input" placeholder="e.g. Westlands and Kilimani blocks" value={description} onChange={(e) => setDescription(e.target.value)} />
        </SheetField>
      </SheetSection>
    </FormSheet>
  );
}

/** Group properties by area (Nairobi, Nakuru...) for location-level reporting. */
export default function LocationsPage() {
  const queryClient = useQueryClient();
  const { can } = useLandlordAccess();
  const manage = can('locations.manage');
  const { data: locations = [], isLoading } = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const { data: properties = [] } = useQuery({ queryKey: ['properties', ''], queryFn: () => listProperties() });
  const [editing, setEditing] = useState<PropertyLocation | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: deleteLocation,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['locations'] }); queryClient.invalidateQueries({ queryKey: ['properties'] }); notify('success', 'Location removed'); },
    onError: (err) => notify('error', 'Could not remove', errorMessage(err)),
  });
  const move = useMutation({
    mutationFn: ({ propertyId, locationId }: { propertyId: string; locationId: string | null }) => setPropertyLocation(propertyId, locationId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['locations'] }); queryClient.invalidateQueries({ queryKey: ['properties'] }); },
    onError: (err) => notify('error', 'Could not move property', errorMessage(err)),
  });

  const unassigned = properties.filter((p) => !p.locationId);

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Portfolio"
        title="Locations"
        subtitle="Group properties by area for location-level reports and filtering."
        actions={manage && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> New location</button>}
      />

      {isLoading ? <LoadingBlock /> : locations.length === 0 ? (
        <div className="card"><EmptyState icon={<MapPin size={28} />} title="No locations yet" hint="Add Nairobi, Nakuru or any area you own property in." action={manage ? <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Plus size={14} /> New location</button> : undefined} /></div>
      ) : (
        <div className="rn-loc-grid">
          {locations.map((l) => (
            <article key={l.id} className="hd-card rn-loc-card">
              <div className="hd-card-head">
                <b><MapPin size={15} /> {l.name}</b>
                {manage && (
                  <span className="flex gap-1">
                    <button className="icon-btn" title="Edit" onClick={() => setEditing(l)}><Pencil size={13} /></button>
                    <button className="icon-btn" title="Remove" onClick={async () => { if (await confirmDialog({ title: `Remove ${l.name}?`, text: 'Its properties stay, just without a location.', confirmLabel: 'Remove', danger: true })) remove.mutate(l.id); }}><Trash2 size={13} /></button>
                  </span>
                )}
              </div>
              {(l.county || l.description) && <p className="rn-muted" style={{ margin: '-6px 0 10px' }}>{[l.county, l.description].filter(Boolean).join(' · ')}</p>}
              <div className="rn-loc-stats">
                <span><b>{l.propertyCount}</b> properties</span>
                <span><b>{l.units}</b> units</span>
                <span><b>{l.units ? Math.round((l.occupied / l.units) * 100) : 0}%</b> let</span>
              </div>
              <ul className="rn-loc-props">
                {l.properties.length === 0 ? <li className="rn-muted">No properties yet</li> : l.properties.map((p) => (
                  <li key={p.id}>
                    <Building2 size={13} /> {p.name}
                    {manage && <button className="rn-link" onClick={() => move.mutate({ propertyId: p.id, locationId: null })}>remove</button>}
                  </li>
                ))}
              </ul>
              {manage && unassigned.length > 0 && (
                <select className="eoc-select" value="" onChange={(e) => e.target.value && move.mutate({ propertyId: e.target.value, locationId: l.id })}>
                  <option value="">+ Add a property…</option>
                  {unassigned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </article>
          ))}
        </div>
      )}

      {unassigned.length > 0 && locations.length > 0 && (
        <p className="rn-muted">{unassigned.length} propert{unassigned.length === 1 ? 'y has' : 'ies have'} no location: {unassigned.map((p) => p.name).join(', ')}.</p>
      )}

      {editing && <LocationModal location={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
