import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Building2, Check, CircleAlert, Eye, EyeOff, Gauge, KeyRound, Landmark, Store, UserRound, X, type LucideIcon } from 'lucide-react';
import { registerVendor } from '@/api/accounts';
import { errorMessage } from '@/api/client';
import { alertInfo } from '@/lib/alert';
import AppLoader from '@/components/shared/AppLoader';
import { LogoLockup } from '@/components/brand/Logo';
import { BANKS, Err, Label, StrengthMeter } from '@/pages/partners/vendorFormParts';

const schema = z
  .object({
    vendorType: z.enum(['INDIVIDUAL', 'COMPANY']),
    businessName: z.string().trim().optional(),
    address: z.string().trim().min(2, 'Address is required').max(255),
    bankName: z.string().trim().min(2, 'Choose or enter your bank'),
    accountId: z.string().trim().min(1, 'Till / account ID is required'),
    paybill: z.string().trim().optional(),
    name: z.string().trim().min(2, 'Your full name is required'),
    phone: z.string().trim().min(9, 'Phone is required'),
    email: z.string().trim().email('Enter a valid email'),
    username: z.string().trim().min(3, 'At least 3 characters'),
    password: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { message: "Passwords don't match", path: ['confirmPassword'] })
  .refine((d) => d.vendorType !== 'COMPANY' || (d.businessName ?? '').length >= 2, { message: 'Company name is required', path: ['businessName'] });

type Form = z.infer<typeof schema>;
type SectionId = 'business' | 'settlement' | 'contact' | 'login';

const SECTIONS: { id: SectionId; title: string; Icon: LucideIcon; fields: (keyof Form)[] }[] = [
  { id: 'business', title: 'Business', Icon: Building2, fields: ['vendorType', 'businessName', 'address'] },
  { id: 'settlement', title: 'Settlement', Icon: Landmark, fields: ['bankName', 'accountId', 'paybill'] },
  { id: 'contact', title: 'Contact', Icon: UserRound, fields: ['name', 'phone', 'email'] },
  { id: 'login', title: 'Login', Icon: KeyRound, fields: ['username', 'password', 'confirmPassword'] },
];

/** Public vendor self-registration: the stepped form, landing in the admin approval queue. */
function RegisterPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { vendorType: 'INDIVIDUAL', bankName: '', address: '' },
  });

  const v = watch();
  const isCompany = v.vendorType === 'COMPANY';
  const knownBank = BANKS.some(([b]) => b === v.bankName);
  const [otherBank, setOtherBank] = useState(false);

  const done: Record<SectionId, boolean> = {
    business: (v.address ?? '').trim().length >= 2 && (!isCompany || (v.businessName ?? '').trim().length >= 2),
    settlement: (v.bankName ?? '').trim().length >= 2 && (v.accountId ?? '').trim().length >= 1,
    contact: (v.name ?? '').trim().length >= 2 && (v.phone ?? '').trim().length >= 9 && z.string().email().safeParse((v.email ?? '').trim()).success,
    login: (v.username ?? '').trim().length >= 3 && (v.password ?? '').length >= 8 && v.password === v.confirmPassword,
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

  const onInvalid = (errs: FieldErrors<Form>) => {
    const first = SECTIONS.find((s) => s.fields.some((f) => errs[f]));
    if (first) goTo(first.id);
  };

  const onSubmit = async ({ confirmPassword: _c, ...data }: Form) => {
    setError('');
    try {
      const message = await registerVendor({ ...data, businessName: data.businessName || undefined, paybill: data.paybill || undefined });
      await alertInfo('Registration received', message);
      navigate('/login');
    } catch (err) {
      setError(errorMessage(err, 'Registration failed. Please try again.'));
      bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
    <div className="vf-page">
      <Link to="/" className="vf-page-brand" aria-label="TokenPap home"><LogoLockup height={46} /></Link>

      <form className="vf-modal vf-standalone" onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate>
        <header className="vf-head">
          <div className="vf-head-row">
            <span className="vf-head-ico"><Store size={22} /></span>
            <div className="vf-head-text">
              <h2>Become a vendor</h2>
              <p>Register to sell prepaid tokens. An administrator reviews every application. Fields marked <b>*</b> are required.</p>
            </div>
            <Link to="/" className="vf-close" aria-label="Back to home"><X size={18} /></Link>
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
          {error && <div className="vf-alert" role="alert"><CircleAlert size={16} /> {error}</div>}

          {section('business', (
            <>
              <div className="vf-field">
                <Label required>I am registering as</Label>
                <div className="vf-chips" role="radiogroup">
                  {(['INDIVIDUAL', 'COMPANY'] as const).map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={v.vendorType === t} className={`vf-chip${v.vendorType === t ? ' on' : ''}`} onClick={() => setValue('vendorType', t)}>
                      <i />{t === 'INDIVIDUAL' ? 'An individual' : 'A company'}
                    </button>
                  ))}
                </div>
              </div>
              {isCompany && (
                <label className="vf-field">
                  <Label required>Company name</Label>
                  <input className="input" placeholder="e.g. Brightline Utilities Ltd" {...register('businessName')} />
                  <Err message={errors.businessName?.message} />
                </label>
              )}
              <label className="vf-field">
                <span className="vf-label-row"><Label required>Physical address</Label><small>{(v.address ?? '').length} characters</small></span>
                <textarea className="eoc-textarea" rows={2} maxLength={255} placeholder="e.g. Shop 12, Westlands Square, Nairobi" {...register('address')} />
                <Err message={errors.address?.message} />
              </label>
            </>
          ))}

          {section('settlement', (
            <>
              <div className="vf-field">
                <Label required>Bank</Label>
                <div className="vf-banks">
                  {BANKS.map(([bank, code]) => (
                    <button key={bank} type="button" className={`vf-bank${v.bankName === bank ? ' on' : ''}`} onClick={() => { setOtherBank(false); setValue('bankName', bank, { shouldValidate: !!errors.bankName }); }}>
                      <span>{code}</span>{bank}
                    </button>
                  ))}
                  <button type="button" className={`vf-bank${otherBank ? ' on' : ''}`} onClick={() => { setOtherBank(true); if (knownBank) setValue('bankName', ''); }}>
                    <span>+</span>Other bank
                  </button>
                </div>
                {otherBank && <input className="input" autoFocus placeholder="Bank name" {...register('bankName')} />}
                <Err message={errors.bankName?.message} />
              </div>
              <div className="vf-grid">
                <label className="vf-field">
                  <Label required>Till / account ID</Label>
                  <input className="input mono" placeholder="Where your sales settle" {...register('accountId')} />
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
                <Label required>Full name</Label>
                <input className="input" autoComplete="name" {...register('name')} />
                <Err message={errors.name?.message} />
              </label>
              <label className="vf-field">
                <Label required>Phone</Label>
                <input className="input" inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" {...register('phone')} />
                <Err message={errors.phone?.message} />
              </label>
              <label className="vf-field vf-span">
                <Label required>Email</Label>
                <input className="input" type="email" autoComplete="email" placeholder="name@business.co.ke" {...register('email')} />
                <Err message={errors.email?.message} />
              </label>
            </div>
          ))}

          {section('login', (
            <>
              <label className="vf-field">
                <Label required>Username</Label>
                <input className="input" autoComplete="username" placeholder="You’ll sign in with this" {...register('username')} />
                <Err message={errors.username?.message} />
              </label>
              <div className="vf-grid">
                <label className="vf-field">
                  <Label required>Password</Label>
                  <span className="vf-pw">
                    <input className="input" type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" {...register('password')} />
                    <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </span>
                  <StrengthMeter password={v.password ?? ''} />
                  <Err message={errors.password?.message} />
                </label>
                <label className="vf-field">
                  <Label required>Confirm password</Label>
                  <input className="input" type={showPw ? 'text' : 'password'} autoComplete="new-password" {...register('confirmPassword')} />
                  <Err message={errors.confirmPassword?.message} />
                </label>
              </div>
              <p className="vf-note">After you submit, a TokenPap administrator reviews your details. You’ll be able to sign in once your account is approved.</p>
            </>
          ))}
        </div>

        <footer className="vf-foot">
          <span className="vf-foot-meta"><Gauge size={15} /> <b>Application</b> · {pct}% · Already registered? <Link to="/login" className="vf-link">Sign in</Link></span>
          <span className="vf-foot-actions">
            <Link to="/" className="vf-btn vf-btn-ghost">Cancel</Link>
            <button type="submit" className="vf-btn vf-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <AppLoader size={16} /> : <>Submit registration <ArrowRight size={16} /></>}
            </button>
          </span>
        </footer>
      </form>
    </div>
  );
}

export default RegisterPage;
