import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Home, MapPin } from 'lucide-react';
import { listLandlords } from '@/api/accounts';
import { getLandlordPropertyUnits, listLandlordProperties } from '@/api/properties';
import { humanize } from '@/lib/format';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/shared/ui';
import { PaymentChip } from './paymentAccount';

/** Read-only view of any landlord's properties and units; landlords edit from their own portal. */
function AdminPropertyUnitsPage() {
  const [params, setParams] = useSearchParams();
  const landlordId = params.get('landlord') ?? '';
  const propertyId = params.get('property') ?? '';

  const { data: landlords, isLoading: landlordsLoading } = useQuery({ queryKey: ['landlords', 'options'], queryFn: () => listLandlords({ page: 1, limit: 200 }) });
  const { data: properties = [], isLoading: propsLoading } = useQuery({
    queryKey: ['landlord-properties', landlordId],
    queryFn: () => listLandlordProperties(landlordId),
    enabled: !!landlordId,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['landlord-property-units', landlordId, propertyId],
    queryFn: () => getLandlordPropertyUnits(landlordId, propertyId),
    enabled: !!landlordId && !!propertyId,
  });

  // Default to the first landlord, then their first property.
  useEffect(() => {
    const first = landlords?.data[0];
    if (!landlordId && first) setParams({ landlord: first.id }, { replace: true });
  }, [landlordId, landlords, setParams]);
  useEffect(() => {
    if (landlordId && !propertyId && properties[0]) setParams({ landlord: landlordId, property: properties[0].id }, { replace: true });
  }, [landlordId, propertyId, properties, setParams]);

  const header = (
    <PageHeader
      eyebrow="Properties"
      title="Property units"
      subtitle="Browse any landlord's properties and units. Landlords make changes from their own portal."
      actions={
        <>
          <select className="eoc-select" value={landlordId} onChange={(e) => setParams({ landlord: e.target.value })} aria-label="Landlord">
            {landlords?.data.map((l) => <option key={l.id} value={l.id}>{l.fullName}</option>)}
          </select>
          {properties.length > 0 && (
            <select className="eoc-select" value={propertyId} onChange={(e) => setParams({ landlord: landlordId, property: e.target.value })} aria-label="Property">
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </>
      }
    />
  );

  if (landlordsLoading) return <LoadingBlock />;
  if (!landlords?.data.length) {
    return (
      <div className="col" style={{ gap: 20 }}>
        {header}
        <div className="card"><EmptyState icon={<Home size={28} />} title="No landlords yet" hint="Register a landlord under Landlords first." /></div>
      </div>
    );
  }

  const unitName = (id: string | null) => data?.units.find((u) => u.id === id)?.name ?? '-';

  return (
    <div className="col" style={{ gap: 20 }}>
      {header}
      {propsLoading ? <LoadingBlock /> : properties.length === 0 ? (
        <div className="card"><EmptyState icon={<MapPin size={28} />} title="This landlord has no properties" hint="Properties appear here once the landlord adds them." /></div>
      ) : isLoading || !data ? <LoadingBlock /> : (
        <>
          <div className="card">
            <div className="card-head">
              <span className="card-title">{data.property.name}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {humanize(data.property.propertyType)} · {data.property.location} · {data.units.length} unit(s) · {data.assignedMeters.length} assigned meter(s)
              </span>
            </div>
            {data.units.length === 0 ? <EmptyState title="No units yet" /> : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr>{['Unit', 'Occupancy', 'Rent /mo', 'Payment account', 'Meter'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.units.map((u) => (
                      <tr key={u.id}>
                        <td className="strong">{u.name}</td>
                        <td>{u.activeLease ? <span className="pill pill-green">{u.activeLease.tenantName}</span> : <span className="pill pill-gray">Vacant</span>}</td>
                        <td className="mono">{u.monthlyRent?.toLocaleString('en-KE') ?? '-'}</td>
                        <td>{u.payment ? <PaymentChip payment={u.payment} /> : <span className="rn-muted">Not set</span>}</td>
                        <td className="mono">{u.meterNumber ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><span className="card-title">Tenants</span></div>
            {data.tenants.length === 0 ? <EmptyState title="No tenants yet" /> : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr>{['Name', 'Phone', 'Email', 'Unit'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.tenants.map((t) => (
                      <tr key={t.id}>
                        <td className="strong">{t.name}</td>
                        <td>{t.phone}</td>
                        <td>{t.email ?? '-'}</td>
                        <td>{unitName(t.unitId)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default AdminPropertyUnitsPage;
