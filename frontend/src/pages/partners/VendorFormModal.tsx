import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Check, Eye, EyeOff, Gauge, KeyRound, Landmark, Store, UserRound, X, type LucideIcon } from 'lucide-react';
import { createVendor, updateVendor, type VendorInput } from '@/api/accounts';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import AppLoader from '@/components/shared/AppLoader';
import type { Vendor } from '@/types/api';
import { BANKS, Err, Label, StrengthMeter } from './vendorFormParts';

const baseSchema = z.object({
  name: z.string().trim().min(2, 'Contact name is required'),
  username: z.string().trim().min(3, 'At least 3 characters'),
  email: z.string().trim().email('Enter a valid email'),
  phone: z.string().trim().optional(),
  password: z.string(),
  businessName: z.string().trim().min(2, 'Business name is required'),
  address: z.string().trim().max(255).optional(),
  accountId: z.string().trim().min(1, 'Account / till ID is required'),
  paybill: z.string().trim().optional(),
  vendorType: z.enum(['INDIVIDUAL', 'COMPANY']),
  bankName: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
type VendorForm = z.infer<typeof baseSchema>;
type Key = keyof VendorForm;

type SectionId = 'business' | 'settlement' | 'contact' | 'login';
const SECTIONS: { id: SectionId; title: string; Icon: LucideIcon; fields: Key[] }[] = [
  { id: 'business', title: 'Business', Icon: Building2, fields: ['vendorType', 'businessName', 'address'] },
  { id: 'settlement', title: 'Settlement', Icon: Landmark, fields: ['bankName', 'accountId', 'paybill'] },
  { id: 'contact', title: 'Contact', Icon: UserRound, fields: ['name', 'phone', 'email'] },
  { id: 'login', title: 'Login', Icon: KeyRound, fields: ['username', 'password', 'status'] },
];


/** Register (or edit) a vendor: one scrolling form split into four numbered steps. */
export default function VendorFormModal({ vendor, onClose }: { vendor?: Vendor; onClose: () => void }) {
  const queryClient = useQueryClient();
  const editing = !!vendor;
  const schema = baseSchema.refine((d) => (editing ? !d.password || d.password.length >= 8 : d.password.length >= 8), {
    message: 'At least 8 characters', path: ['password'],
  });

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<VendorForm>({
    resolver: zodResolver(schema),
    defaultValues: vendor
      ? {
          name: vendor.user.name, username: vendor.user.username, email: vendor.user.email, phone: vendor.user.phone ?? '', password: '',
          businessName: vendor.businessName, address: vendor.address ?? '', accountId: vendor.accountId, paybill: vendor.paybill ?? '',
          vendorType: vendor.vendorType, bankName: vendor.bankName ?? '', status: vendor.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        }
      : { vendorType: 'INDIVIDUAL', password: '', bankName: '', address: '' },
  });

  const v = watch();
  const [showPw, setShowPw] = useState(false);
  const knownBank = BANKS.some(([b]) => b === v.bankName);
  const [otherBank, setOtherBank] = useState(!!v.bankName && !knownBank);

  // Section completion drives the step badges and the progress bar.
  const done: Record<SectionId, boolean> = {
    business: (v.businessName ?? '').trim().length >= 2,
    settlement: (v.accountId ?? '').trim().length >= 1,
    contact: (v.name ?? '').trim().length >= 2 && z.string().email().safeParse((v.email ?? '').trim()).success,
    login: (v.username ?? '').trim().length >= 3 && (editing ? !v.password || v.password.length >= 8 : (v.password ?? '').length >= 8),
  };
  const completed = SECTIONS.filter((s) => done[s.id]).length;
  const pct = Math.round((completed / SECTIONS.length) * 100);

  // Step tabs follow the scroll position; clicking a tab scrolls to its section.
  const bodyRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const [active, setActive] = useState<SectionId>('business');

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
    let current: SectionId = 'business';
    for (const s of SECTIONS) {
      const el = refs.current[s.id];
      if (el && el.offsetTop - body.scrollTop <= 90) current = s.id;
    }
    setActive(atBottom ? 'login' : current);
  };

  const goTo = (id: SectionId) => {
    const body = bodyRef.current;
    const el = refs.current[id];
    if (body && el) body.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
    setActive(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onInvalid = (errs: FieldErrors<VendorForm>) => {
    const first = SECTIONS.find((s) => s.fields.some((f) => errs[f]));
    if (first) goTo(first.id);
  };

  const onSubmit = async (form: VendorForm) => {
    const clean = Object.fromEntries(Object.entries(form).filter(([, val]) => val !== '')) as Partial<VendorInput> & { status?: 'ACTIVE' | 'SUSPENDED' };
    try {
      if (vendor) await updateVendor(vendor.id, clean);
      else await createVendor(clean as VendorInput);
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      notify('success', vendor ? 'Vendor updated' : 'Vendor registered', vendor ? undefined : `${form.businessName} can now sign in as ${form.username}.`);
      onClose();
    } catch (err) {
      notify('error', 'Could not save vendor', errorMessage(err));
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

  return (
    <div className="vf-overlay" onClick={onClose}>
      <form className="vf-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate>
        <header className="vf-head">
          <div className="vf-head-row">
            <span className="vf-head-ico"><Store size={22} /></span>
            <div className="vf-head-text">
              <h2>{editing ? `Edit ${vendor.businessName}` : 'Register a vendor'}</h2>
              <p>{editing ? 'Update the vendor’s business, settlement and login details.' : 'Add a business that sells tokens on TokenPap.'} Fields marked <b>*</b> are required.</p>
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
          {section('business', (
            <>
              <div className="vf-field">
                <Label required>Vendor type</Label>
                <div className="vf-chips" role="radiogroup">
                  {(['INDIVIDUAL', 'COMPANY'] as const).map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={v.vendorType === t} className={`vf-chip${v.vendorType === t ? ' on' : ''}`} onClick={() => setValue('vendorType', t, { shouldDirty: true })}>
                      <i />{t === 'INDIVIDUAL' ? 'Individual' : 'Company'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="vf-field">
                <Label required>{v.vendorType === 'COMPANY' ? 'Company name' : 'Business / trading name'}</Label>
                <input className="input" placeholder={v.vendorType === 'COMPANY' ? 'e.g. Brightline Utilities Ltd' : 'e.g. Mama Wanjiku Tokens'} {...register('businessName')} />
                <Err message={errors.businessName?.message} />
              </label>
              <label className="vf-field">
                <span className="vf-label-row"><Label>Physical address</Label><small>{(v.address ?? '').length} characters</small></span>
                <textarea className="eoc-textarea" rows={2} maxLength={255} placeholder="e.g. Shop 12, Westlands Square, Nairobi" {...register('address')} />
              </label>
            </>
          ))}

          {section('settlement', (
            <>
              <div className="vf-field">
                <Label>Bank</Label>
                <div className="vf-banks">
                  {BANKS.map(([bank, code]) => (
                    <button key={bank} type="button" className={`vf-bank${v.bankName === bank ? ' on' : ''}`} onClick={() => { setOtherBank(false); setValue('bankName', v.bankName === bank ? '' : bank, { shouldDirty: true }); }}>
                      <span>{code}</span>{bank}
                    </button>
                  ))}
                  <button type="button" className={`vf-bank${otherBank ? ' on' : ''}`} onClick={() => { setOtherBank(true); if (knownBank) setValue('bankName', ''); }}>
                    <span>+</span>Other bank
                  </button>
                </div>
                {otherBank && <input className="input" autoFocus placeholder="Bank name" {...register('bankName')} />}
              </div>
              <div className="vf-grid">
                <label className="vf-field">
                  <Label required>Account / till ID</Label>
                  <input className="input mono" placeholder="Settlement account or till" {...register('accountId')} />
                  <Err message={errors.accountId?.message} />
                </label>
                <label className="vf-field">
                  <Label>Paybill</Label>
                  <input className="input mono" inputMode="numeric" placeholder="Optional" {...register('paybill')} />
                </label>
              </div>
            </>
          ))}

          {section('contact', (
            <div className="vf-grid">
              <label className="vf-field">
                <Label required>Contact name</Label>
                <input className="input" placeholder="Person we can reach" {...register('name')} />
                <Err message={errors.name?.message} />
              </label>
              <label className="vf-field">
                <Label>Phone</Label>
                <input className="input" inputMode="tel" placeholder="07XX XXX XXX" {...register('phone')} />
              </label>
              <label className="vf-field vf-span">
                <Label required>Email</Label>
                <input className="input" type="email" placeholder="name@business.co.ke" {...register('email')} />
                <Err message={errors.email?.message} />
              </label>
            </div>
          ))}

          {section('login', (
            <>
              <div className="vf-grid">
                <label className="vf-field">
                  <Label required>Username</Label>
                  <input className="input" autoComplete="off" placeholder="Used to sign in" {...register('username')} />
                  <Err message={errors.username?.message} />
                </label>
                <label className="vf-field">
                  <Label required={!editing}>{editing ? 'New password (optional)' : 'Password'}</Label>
                  <span className="vf-pw">
                    <input className="input" type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder={editing ? 'Leave blank to keep' : 'At least 8 characters'} {...register('password')} />
                    <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </span>
                  <StrengthMeter password={v.password ?? ''} />
                  <Err message={errors.password?.message} />
                </label>
              </div>
              {editing && (
                <div className="vf-field">
                  <Label>Account status</Label>
                  <div className="vf-chips" role="radiogroup">
                    {(['ACTIVE', 'SUSPENDED'] as const).map((st) => (
                      <button key={st} type="button" role="radio" aria-checked={v.status === st} className={`vf-chip ${st === 'ACTIVE' ? 'ok' : 'warn'}${v.status === st ? ' on' : ''}`} onClick={() => setValue('status', st, { shouldDirty: true })}>
                        <i />{st === 'ACTIVE' ? 'Active' : 'Suspended'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!editing && <p className="vf-note">The vendor is active immediately and can sign in with this username and password. Assign meters to them from <b>Assigned Meters</b>.</p>}
            </>
          ))}
        </div>

        <footer className="vf-foot">
          <span className="vf-foot-meta"><Gauge size={15} /> <b>{editing ? 'Editing' : 'New vendor'}</b> · {v.businessName?.trim() || 'Untitled'} · {pct}%</span>
          <span className="vf-foot-actions">
            <button type="button" className="vf-btn vf-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="vf-btn vf-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <AppLoader size={16} /> : <><Check size={16} strokeWidth={2.6} /> {editing ? 'Save changes' : 'Register vendor'}</>}
            </button>
          </span>
        </footer>
      </form>
    </div>
  );
}
