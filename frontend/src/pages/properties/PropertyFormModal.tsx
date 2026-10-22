import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight, BedDouble, Building, Building2, Check, ChevronRight, DoorOpen, Home, Layers, MapPin, Minus, Plus, Shapes, Store, X, type LucideIcon,
} from 'lucide-react';
import { createProperty, updateProperty, type PropertyInput } from '@/api/properties';
import { listLocations } from '@/api/rentals';
import { listConstituencies, listCounties, listWards } from '@/api/meters';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import AppLoader from '@/components/shared/AppLoader';
import { Err, Label } from '@/pages/partners/vendorFormParts';
import type { Property, PropertyType } from '@/types/api';

const MAX_UNITS = 500;

const PROPERTY_TYPES: { value: PropertyType; label: string; hint: string; Icon: LucideIcon }[] = [
  { value: 'APARTMENT', label: 'Apartment block', hint: 'Flats in one building', Icon: Building2 },
  { value: 'ESTATE', label: 'Estate', hint: 'Houses in a compound', Icon: Home },
  { value: 'COMMERCIAL', label: 'Commercial', hint: 'Shops and offices', Icon: Store },
  { value: 'MIXED_USE', label: 'Mixed use', hint: 'Shops below, homes above', Icon: Layers },
  { value: 'HOSTEL', label: 'Hostel', hint: 'Rooms or bedsitters', Icon: BedDouble },
  { value: 'OTHER', label: 'Other', hint: 'Anything else', Icon: Shapes },
];

const UNIT_PRESETS = [1, 5, 10, 20, 50];

/** Quick picks shown above the county list. */
const POPULAR_COUNTIES = ['Nairobi City', 'Kiambu', 'Nakuru', 'Mombasa', 'Kisumu', 'Machakos', 'Kajiado'];

const schema = z.object({
  name: z.string().trim().min(2, 'Give the property a name'),
  propertyType: z.enum(['APARTMENT', 'ESTATE', 'COMMERCIAL', 'MIXED_USE', 'HOSTEL', 'OTHER']),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  noOfUnits: z.number({ message: 'Enter a number' }).int().min(1, 'At least 1 unit').max(MAX_UNITS, `At most ${MAX_UNITS} units`),
  locationId: z.string().optional(),
  countyId: z.string().min(1, 'Choose the county'),
  constituencyId: z.string().optional(),
  wardId: z.string().optional(),
  location: z.string().trim().min(2, 'Enter the street address'),
});
type Form = z.infer<typeof schema>;
type SectionId = 'details' | 'units' | 'location';

const SECTIONS: { id: SectionId; title: string; Icon: LucideIcon; fields: (keyof Form)[] }[] = [
  { id: 'details', title: 'Details', Icon: Building, fields: ['name', 'propertyType', 'status'] },
  { id: 'units', title: 'Units', Icon: DoorOpen, fields: ['noOfUnits'] },
  { id: 'location', title: 'Location', Icon: MapPin, fields: ['locationId', 'countyId', 'constituencyId', 'wardId', 'location'] },
];

/** Add / edit a property: details, how many units, and where it is. New properties land on their Units page. */
function PropertyFormModal({ property, onClose }: { property?: Property; onClose: () => void }) {
  const editing = !!property;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: locations = [] } = useQuery({ queryKey: ['locations'], queryFn: listLocations });

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: property?.name ?? '',
      propertyType: property?.propertyType ?? 'APARTMENT',
      status: property?.status ?? 'ACTIVE',
      noOfUnits: property?.noOfUnits ?? 1,
      locationId: property?.locationId ?? '',
      countyId: property?.countyId ? String(property.countyId) : '',
      constituencyId: property?.constituencyId ? String(property.constituencyId) : '',
      wardId: property?.wardId ? String(property.wardId) : '',
      location: property?.location ?? '',
    },
  });

  const v = watch();
  const countyId = Number(v.countyId) || 0;
  const constituencyId = Number(v.constituencyId) || 0;
  const { data: counties = [] } = useQuery({ queryKey: ['counties'], queryFn: listCounties, staleTime: Infinity });
  const { data: constituencies = [], isFetching: loadingConstituencies } = useQuery({
    queryKey: ['constituencies', countyId], queryFn: () => listConstituencies(countyId), enabled: countyId > 0, staleTime: Infinity,
  });
  const { data: wards = [], isFetching: loadingWards } = useQuery({
    queryKey: ['wards', constituencyId], queryFn: () => listWards(constituencyId), enabled: constituencyId > 0, staleTime: Infinity,
  });
  const popular = POPULAR_COUNTIES.map((name) => counties.find((c) => c.name === name)).filter((c): c is NonNullable<typeof c> => !!c);
  const pickCounty = (id: string) => {
    setValue('countyId', id, { shouldValidate: !!errors.countyId });
    setValue('constituencyId', '');
    setValue('wardId', '');
  };
  const trail = [
    counties.find((c) => c.id === countyId)?.name,
    constituencies.find((c) => c.id === constituencyId)?.name,
    wards.find((w) => w.id === Number(v.wardId))?.name,
  ].filter(Boolean) as string[];
  const units = Number.isFinite(v.noOfUnits) ? v.noOfUnits : 0;
  const setUnits = (n: number) => setValue('noOfUnits', Math.min(MAX_UNITS, Math.max(1, Math.round(n) || 1)), { shouldValidate: true });
  const unitDelta = editing ? units - (property?.noOfUnits ?? 0) : 0;

  const done: Record<SectionId, boolean> = {
    details: (v.name ?? '').trim().length >= 2,
    units: units >= 1 && units <= MAX_UNITS,
    location: countyId > 0 && (v.location ?? '').trim().length >= 2,
  };
  const completed = SECTIONS.filter((s) => done[s.id]).length;
  const pct = Math.round((completed / SECTIONS.length) * 100);

  // Step tabs follow the scroll position; clicking a tab scrolls to its section.
  const bodyRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const [active, setActive] = useState<SectionId>('details');

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
    let current: SectionId = 'details';
    for (const s of SECTIONS) {
      const el = refs.current[s.id];
      if (el && el.offsetTop - body.scrollTop <= 90) current = s.id;
    }
    setActive(atBottom ? 'location' : current);
  };

  const goTo = (id: SectionId) => {
    const body = bodyRef.current;
    const el = refs.current[id];
    if (body && el) body.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
    setActive(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onInvalid = (errs: FieldErrors<Form>) => {
    const first = SECTIONS.find((s) => s.fields.some((f) => errs[f]));
    if (first) goTo(first.id);
  };

  const onSubmit = async (f: Form) => {
    const payload: PropertyInput = {
      name: f.name, propertyType: f.propertyType, status: f.status, noOfUnits: f.noOfUnits, location: f.location,
      locationId: f.locationId || null,
      countyId: Number(f.countyId),
      constituencyId: f.constituencyId ? Number(f.constituencyId) : null,
      wardId: f.wardId ? Number(f.wardId) : null,
    };
    try {
      if (property) {
        await updateProperty(property.id, payload);
        queryClient.invalidateQueries({ queryKey: ['properties'] });
        queryClient.invalidateQueries({ queryKey: ['property-units', property.id] });
        notify('success', 'Property updated');
        onClose();
      } else {
        const created = await createProperty(payload);
        queryClient.invalidateQueries({ queryKey: ['properties'] });
        notify('success', 'Property added', `${payload.noOfUnits} unit(s) created. Now set each unit’s rent and payment account.`);
        onClose();
        navigate(`/landlord/units?property=${created.id}`);
      }
    } catch (err) {
      notify('error', 'Could not save property', errorMessage(err));
    }
  };

  const section = (id: SectionId, children: ReactNode) => {
    const s = SECTIONS.find((x) => x.id === id)!;
    return (
      <section className="vf-section" ref={(el) => { refs.current[id] = el; }}>
        <h3 className="vf-section-title"><span className="vf-section-ico"><s.Icon size={15} /></span>{s.title}{done[id] && <Check size={15} className="vf-section-done" />}</h3>
        {children}
      </section>
    );
  };

  const previewCount = Math.min(units, 12);
  const TypeIcon = PROPERTY_TYPES.find((t) => t.value === v.propertyType)?.Icon ?? Building2;

  return (
    <div className="vf-overlay" onClick={onClose}>
      <form className="vf-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate>
        <header className="vf-head">
          <div className="vf-head-row">
            <span className="vf-head-ico"><TypeIcon size={22} /></span>
            <div className="vf-head-text">
              <h2>{editing ? `Edit ${property.name}` : 'Add a property'}</h2>
              <p>{editing ? 'Update the property’s details, unit count and location.' : 'Its units are created for you. Next you’ll set each unit’s rent and payment account.'} Fields marked <b>*</b> are required.</p>
            </div>
            <button type="button" className="vf-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>

          <nav className="vf-steps" aria-label="Form sections">
            {SECTIONS.map((s, i) => (
              <button key={s.id} type="button" className={`vf-step${active === s.id ? ' on' : ''}${done[s.id] ? ' done' : ''}`} onClick={() => goTo(s.id)}>
                <span className="vf-step-num">{done[s.id] && active !== s.id ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                {s.title}
              </button>
            ))}
          </nav>
          <div className="vf-progress">
            <span className="vf-progress-track"><i style={{ width: `${pct}%` }} /></span>
            <b>{completed} of {SECTIONS.length} complete</b>
          </div>
        </header>

        <div className="vf-body scroll-thin" ref={bodyRef} onScroll={onScroll}>
          {section('details', (
            <>
              <label className="vf-field">
                <Label required>Property name</Label>
                <input className="input" autoFocus={!editing} placeholder="e.g. Sunrise Apartments" {...register('name')} />
                <Err message={errors.name?.message} />
              </label>

              <div className="vf-field">
                <Label required>Type</Label>
                <div className="pf-types" role="radiogroup" aria-label="Property type">
                  {PROPERTY_TYPES.map(({ value, label, hint, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={v.propertyType === value}
                      className={`pf-type${v.propertyType === value ? ' on' : ''}`}
                      onClick={() => setValue('propertyType', value)}
                    >
                      <span className="pf-type-ico"><Icon size={18} /></span>
                      <span className="pf-type-text"><b>{label}</b><small>{hint}</small></span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="vf-field">
                <Label>Status</Label>
                <div className="vf-chips" role="radiogroup" aria-label="Status">
                  {(['ACTIVE', 'INACTIVE'] as const).map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={v.status === s} className={`vf-chip ${s === 'ACTIVE' ? 'ok' : 'warn'}${v.status === s ? ' on' : ''}`} onClick={() => setValue('status', s)}>
                      <i />{s === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ))}

          {section('units', (
            <>
              <div className="vf-field">
                <Label required>How many units?</Label>
                <div className="pf-units">
                  <div className="pf-stepper">
                    <button type="button" onClick={() => setUnits(units - 1)} disabled={units <= 1} aria-label="One fewer unit"><Minus size={18} /></button>
                    <input
                      className="mono"
                      inputMode="numeric"
                      aria-label="Number of units"
                      value={Number.isFinite(v.noOfUnits) ? v.noOfUnits : ''}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
                        setValue('noOfUnits', digits === '' ? Number.NaN : Number(digits), { shouldValidate: true });
                      }}
                    />
                    <button type="button" onClick={() => setUnits(units + 1)} disabled={units >= MAX_UNITS} aria-label="One more unit"><Plus size={18} /></button>
                  </div>
                  <div className="vf-chips">
                    {UNIT_PRESETS.map((n) => (
                      <button key={n} type="button" className={`vf-chip${units === n ? ' on' : ''}`} onClick={() => setUnits(n)}>{n}</button>
                    ))}
                  </div>
                </div>
                <Err message={errors.noOfUnits?.message} />
              </div>

              {units >= 1 && (
                <div className="pf-preview" aria-label="Units that will be created">
                  {Array.from({ length: previewCount }, (_, i) => (
                    <span key={i} className="pf-unit"><DoorOpen size={13} /> Unit {i + 1}</span>
                  ))}
                  {units > previewCount && <span className="pf-unit more">+{units - previewCount} more</span>}
                </div>
              )}

              <p className="vf-note">
                {!editing && <>We’ll create <b>{units || 0} unit{units === 1 ? '' : 's'}</b> named Unit 1, Unit 2, … You can rename them and add rent and a payment account to each on the Units page.</>}
                {editing && unitDelta === 0 && <>This property has <b>{units} unit{units === 1 ? '' : 's'}</b>. Change the number to add or remove units.</>}
                {editing && unitDelta > 0 && <><b>{unitDelta} new unit{unitDelta === 1 ? '' : 's'}</b> will be added, numbered on from the last unit.</>}
                {editing && unitDelta < 0 && <>The newest <b>{-unitDelta} unit{unitDelta === -1 ? '' : 's'}</b> that have never been let will be removed. Units with lease history are always kept.</>}
              </p>
            </>
          ))}

          {section('location', (
            <>
              <div className="vf-field">
                <Label required>County</Label>
                {popular.length > 0 && (
                  <div className="vf-chips" aria-label="Popular counties">
                    {popular.map((c) => (
                      <button key={c.id} type="button" className={`vf-chip${countyId === c.id ? ' on' : ''}`} onClick={() => pickCounty(String(c.id))}>
                        <i />{c.name.replace(' City', '')}
                      </button>
                    ))}
                  </div>
                )}
                <select className="eoc-select" value={v.countyId} onChange={(e) => pickCounty(e.target.value)} aria-label="County">
                  <option value="">{counties.length ? `All ${counties.length} counties…` : 'Loading counties…'}</option>
                  {counties.map((c) => <option key={c.id} value={c.id}>{String(c.id).padStart(3, '0')} · {c.name}</option>)}
                </select>
                <Err message={errors.countyId?.message} />
              </div>

              <div className="vf-grid">
                <label className="vf-field">
                  <Label>Constituency</Label>
                  <select
                    className="eoc-select"
                    value={v.constituencyId}
                    disabled={!countyId || loadingConstituencies}
                    onChange={(e) => { setValue('constituencyId', e.target.value); setValue('wardId', ''); }}
                  >
                    <option value="">{!countyId ? 'Choose a county first' : loadingConstituencies ? 'Loading…' : 'Any constituency'}</option>
                    {constituencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="vf-field">
                  <Label>Ward</Label>
                  <select className="eoc-select" value={v.wardId} disabled={!constituencyId || loadingWards} onChange={(e) => setValue('wardId', e.target.value)}>
                    <option value="">{!constituencyId ? 'Choose a constituency first' : loadingWards ? 'Loading…' : 'Any ward'}</option>
                    {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
              </div>

              {trail.length > 0 && (
                <div className="pf-trail" aria-label="Selected location">
                  <MapPin size={15} />
                  {trail.map((t, i) => (
                    <span key={t}>{i > 0 && <ChevronRight size={13} />}{t}</span>
                  ))}
                  <span className="pf-trail-country">Kenya</span>
                </div>
              )}

              <label className="vf-field">
                <Label required>Street address</Label>
                <textarea className="eoc-textarea" rows={2} maxLength={500} placeholder="e.g. Ngong Road, opposite Prestige Plaza" {...register('location')} />
                <Err message={errors.location?.message} />
              </label>

              {locations.length > 0 && (
                <div className="vf-field">
                  <span className="vf-label-row"><Label>Portfolio group</Label><small>Your own grouping for reports</small></span>
                  <div className="vf-chips" role="radiogroup" aria-label="Portfolio group">
                    <button type="button" role="radio" aria-checked={!v.locationId} className={`vf-chip${!v.locationId ? ' on' : ''}`} onClick={() => setValue('locationId', '')}><i />None</button>
                    {locations.map((l) => (
                      <button key={l.id} type="button" role="radio" aria-checked={v.locationId === l.id} className={`vf-chip${v.locationId === l.id ? ' on' : ''}`} onClick={() => setValue('locationId', l.id)}>
                        <i />{l.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ))}
        </div>

        <footer className="vf-foot">
          <span className="vf-foot-meta"><DoorOpen size={15} /> <b>{units || 0} unit{units === 1 ? '' : 's'}</b> · {pct}% complete</span>
          <span className="vf-foot-actions">
            <button type="button" className="vf-btn vf-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="vf-btn vf-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <AppLoader size={16} /> : editing ? 'Save changes' : <>Create property <ArrowRight size={16} /></>}
            </button>
          </span>
        </footer>
      </form>
    </div>
  );
}

export default PropertyFormModal;
