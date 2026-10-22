import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight, Building2, Check, ChevronLeft, ChevronRight, CircleCheck, Copy, FileText, Gauge, History, Home, LifeBuoy, LogIn, Mail,
  Search, ShieldCheck, ShoppingCart, Smartphone, Store, Zap,
} from 'lucide-react';
import PromoFilm, { PAYBILL, filmIsDark, homeEditingAt, islandAt, useFilmClock } from '@/components/promo/PromoFilm';
import { APP_NAME, LogoLockup, LogoMark, Wordmark } from '@/components/brand/Logo';
import AppLoader from '@/components/shared/AppLoader';
import { useAuthStore } from '@/stores/authStore';
import { homePath } from '@/lib/session';
import { trackToken } from '@/api/meters';
import { submitEnquiry } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { fmtDateTime } from '@/lib/datetime';
import { copyText, fmtKes, fmtToken, humanize } from '@/lib/format';
import type { PublicTokenResult } from '@/types/api';

// ── iPhone: plays the promo film, with the Dynamic Island reacting to it ──

function Phone() {
  const t = useFilmClock();
  const island = islandAt(t);
  return (
    <div className="lp-device" aria-hidden="true">
      <div className="lp-screen">
        <StatusBar light={filmIsDark(t)} dimmed={!!island || homeEditingAt(t)} />
        <div className={`lp-island${island ? ' open' : ''}`}>
          <span className="lp-island-mark"><LogoMark size={18} /></span>
          <span className="lp-island-text">{island}</span>
          <CircleCheck size={14} className="lp-island-check" />
        </div>
        <PromoFilm t={t} />
        <div className="lp-home-bar" />
      </div>
    </div>
  );
}

/** iOS status bar: time on the left, signal / Wi-Fi / battery on the right. */
function StatusBar({ light, dimmed }: { light: boolean; dimmed: boolean }) {
  return (
    <div className={`lp-status${light ? ' light' : ''}${dimmed ? ' dimmed' : ''}`}>
      <span className="lp-status-time">9:41</span>
      <span className="lp-status-icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 2.4c2.3 0 4.4.9 6 2.3l1.3-1.4A10.6 10.6 0 0 0 8 .4 10.6 10.6 0 0 0 .7 3.3L2 4.7a8.7 8.7 0 0 1 6-2.3Z" />
          <path d="M8 6c1.3 0 2.5.5 3.4 1.3l1.3-1.4A7 7 0 0 0 8 4a7 7 0 0 0-4.7 1.9l1.3 1.4C5.5 6.5 6.7 6 8 6Z" />
          <path d="M8 9.4c.5 0 1 .2 1.3.5L8 11.6 6.7 9.9c.3-.3.8-.5 1.3-.5Z" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x=".5" y=".5" width="23" height="12" rx="3.6" fill="none" stroke="currentColor" opacity=".4" />
          <rect x="2" y="2" width="20" height="9" rx="2.2" fill="currentColor" />
          <path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fill="currentColor" opacity=".45" />
        </svg>
      </span>
    </div>
  );
}

// ── Content ───────────────────────────────────────────────────────────────────

const FEATURES = [
  { Icon: Smartphone, lead: 'Buy.', rest: 'Straight from M-Pesa.', text: 'Enter your meter number, approve the prompt on your phone, and your token arrives by SMS in seconds.' },
  { Icon: History, lead: 'Track.', rest: 'Never lose a token.', text: 'Deleted the SMS? Look up your latest tokens any time with your meter or phone number.' },
  { Icon: Gauge, lead: 'Manage.', rest: 'For vendors and landlords.', text: 'Set tariffs, onboard customers, map properties to meters and see every sale as it happens.' },
];

const PROMISES = [
  {
    Icon: Zap, a: 'Instant STS tokens.', b: 'Issued in seconds.',
    text: 'Payments are confirmed and turned into standard 20-digit STS tokens automatically, day or night, with no agent in the middle.',
  },
  {
    Icon: Smartphone, a: 'Pay your way.', b: 'M-Pesa or paybill.',
    text: 'Use the M-Pesa prompt on this site, or pay to your vendor’s paybill with your meter number as the account.',
  },
  {
    Icon: Home, a: 'Built for landlords.', b: 'Every unit, mapped.',
    text: 'Add each property with its units, set every unit’s rent and payment account, link a meter and track leases and rent.',
  },
  {
    Icon: Building2, a: 'Built for vendors.', b: 'Your brand, your prices.',
    text: 'Set the price per unit, use your own SMS sender ID and logo, and follow your sales on a live dashboard.',
  },
  {
    Icon: ShieldCheck, a: 'Fully audited.', b: 'Nothing goes missing.',
    text: 'Every payment, token and settings change is recorded, so every shilling can be reconciled.',
  },
];

function PromiseCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const update = () => {
    const el = trackRef.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  };

  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * Math.min(388, el.clientWidth * 0.86), behavior: 'smooth' });
  };

  return (
    <>
      <div className="lp-track" ref={trackRef} onScroll={update}>
        {PROMISES.map(({ Icon, a, b, text }) => (
          <article key={a} className="lp-pcard">
            <span className="lp-pcard-ico"><Icon size={28} strokeWidth={1.6} /></span>
            <h3><span>{a}</span><span>{b}</span></h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
      <div className="lp-track-nav">
        <button className="lp-round" onClick={() => scroll(-1)} disabled={edge.start} aria-label="Previous"><ChevronLeft size={18} /></button>
        <button className="lp-round" onClick={() => scroll(1)} disabled={edge.end} aria-label="Next"><ChevronRight size={18} /></button>
      </div>
    </>
  );
}

// ── Track a token ─────────────────────────────────────────────────────────────

function TokenRow({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="lp-token">
      <span>{fmtToken(token)}</span>
      <button
        type="button"
        aria-label="Copy token"
        onClick={async () => {
          if (await copyText(token)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

function TrackSection() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicTokenResult[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 3) return setError('Enter your full meter number or phone number.');
    setError('');
    setBusy(true);
    try {
      setResults(await trackToken(query.trim()));
    } catch (err) {
      setResults(null);
      setError(errorMessage(err, 'No matching meter or customer found.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lp-section" id="track">
      <h2 className="lp-section-title">Lost your token? <strong>Find it here.</strong></h2>
      <p className="lp-section-sub">Your latest tokens, looked up with your meter number or the phone number registered to it.</p>
      <div className="lp-panel">
        <form className="lp-search" onSubmit={onSubmit}>
          <input className="lp-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Meter number or phone number" aria-label="Meter number or phone number" />
          <button className="lp-btn" type="submit" disabled={busy}>{busy ? <AppLoader size={18} /> : <><Search size={16} /> Find my token</>}</button>
        </form>
        {error && <p className="lp-error">{error}</p>}
        {results && (
          <div className="lp-results">
            {results.length === 0 && <p className="lp-section-sub" style={{ margin: 0 }}>No token purchases found for this meter yet.</p>}
            {results.map((r) => (
              <div key={r.id} className="lp-result">
                <div className="lp-result-head">
                  <span>Meter <b>{r.meter?.meterNumber ?? '-'}</b> · {humanize(r.tokenType)}{r.amount ? ` · ${fmtKes(r.amount)}` : ''}</span>
                  <span>{fmtDateTime(r.createdAt)}</span>
                </div>
                {r.tokens.length ? r.tokens.map((tk) => <TokenRow key={tk} token={tk} />) : <span className="lp-error" style={{ margin: 0 }}>{r.description ?? 'No token was issued for this payment.'}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Get meters installed ──────────────────────────────────────────────────────

const METER_TYPES = ['Electricity', 'Water', 'Gas'];

const enquirySchema = z.object({
  firstName: z.string().trim().min(1, 'Required'),
  lastName: z.string().trim().min(1, 'Required'),
  email: z.string().trim().email('Invalid email'),
  phone: z.string().trim().min(9, 'Required'),
  city: z.string().trim().min(1, 'Required'),
  premisesType: z.string().min(1, 'Required'),
  residenceType: z.string().min(1, 'Required'),
  meterTypes: z.array(z.string()).min(1, 'Pick at least one'),
  mainMeterType: z.string().min(1, 'Required'),
  message: z.string().trim().min(5, 'Tell us a little about your needs'),
});
type EnquiryForm = z.infer<typeof enquirySchema>;

function EnquirySection() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<EnquiryForm>({
    resolver: zodResolver(enquirySchema),
    defaultValues: { meterTypes: [] },
  });

  const onSubmit = async (data: EnquiryForm) => {
    try {
      await submitEnquiry(data);
      setSent(true);
      reset();
    } catch (err) {
      notify('error', 'Could not send enquiry', errorMessage(err));
    }
  };

  const field = (label: string, name: keyof EnquiryForm, input: ReactElement) => (
    <label className="lp-field">
      {label}
      {input}
      {errors[name] && <span className="lp-field-err">{errors[name]?.message as string}</span>}
    </label>
  );

  return (
    <section className="lp-section" id="contact">
      <h2 className="lp-section-title">Smart meters <strong>for your property.</strong></h2>
      <p className="lp-section-sub">Tell us about your building and our team will get back to you within one business day.</p>
      <div className="lp-panel">
        {sent ? (
          <div className="lp-form">
            <p className="lp-thanks">Thank you - your enquiry has been received.</p>
            <button className="lp-btn" style={{ justifySelf: 'start' }} onClick={() => setSent(false)}>Send another</button>
          </div>
        ) : (
          <form className="lp-form" onSubmit={handleSubmit(onSubmit)}>
            <div className="lp-form-grid">
              {field('First name', 'firstName', <input className="lp-input" {...register('firstName')} />)}
              {field('Last name', 'lastName', <input className="lp-input" {...register('lastName')} />)}
              {field('Email', 'email', <input className="lp-input" type="email" {...register('email')} />)}
              {field('Phone', 'phone', <input className="lp-input" inputMode="tel" {...register('phone')} />)}
              {field('City / town', 'city', <input className="lp-input" {...register('city')} />)}
              {field('Premises', 'premisesType', (
                <select {...register('premisesType')}>
                  <option value="">Select…</option>
                  {['Residential', 'Commercial', 'Industrial', 'Mixed use'].map((v) => <option key={v}>{v}</option>)}
                </select>
              ))}
              {field('Property type', 'residenceType', (
                <select {...register('residenceType')}>
                  <option value="">Select…</option>
                  {['Apartment block', 'Standalone house', 'Gated community', 'Business premises', 'Other'].map((v) => <option key={v}>{v}</option>)}
                </select>
              ))}
              {field('Current main meter', 'mainMeterType', (
                <select {...register('mainMeterType')}>
                  <option value="">Select…</option>
                  {['Prepaid', 'Postpaid', 'None'].map((v) => <option key={v}>{v}</option>)}
                </select>
              ))}
            </div>
            <div className="lp-field">
              Meters needed
              <div className="lp-checks">
                {METER_TYPES.map((t) => (
                  <label key={t}><input type="checkbox" value={t} {...register('meterTypes')} /> {t}</label>
                ))}
              </div>
              {errors.meterTypes && <span className="lp-field-err">{errors.meterTypes.message}</span>}
            </div>
            {field('Message', 'message', <textarea placeholder="How many units? Any timelines?" {...register('message')} />)}
            <button className="lp-btn" type="submit" disabled={isSubmitting} style={{ justifySelf: 'start' }}>
              {isSubmitting ? <AppLoader size={18} /> : <>Send enquiry <ArrowRight size={16} /></>}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function LandingPage() {
  const user = useAuthStore((s) => s.user);
  const dashboard = user ? homePath(user.role) : '/login';

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-nav-brand"><LogoMark size={38} /><Wordmark height={19} /></Link>
          <nav className="lp-nav-links">
            <a href="#track" className="lp-hide-sm">Track token</a>
            <a href="#contact" className="lp-hide-sm">Get meters</a>
            {!user && <Link to="/register" className="lp-hide-sm">Become a vendor</Link>}
            <Link to={dashboard} className="lp-nav-cta">{user ? 'Dashboard' : 'Sign in'}</Link>
          </nav>
        </div>
      </header>

      <section className="lp-hero2">
        <Phone />
        <div className="lp-hero2-copy fade-up">
          <div className="lp-hero2-brand">
            <LogoLockup height={84} />
          </div>
          <h1 className="lp-hero2-title">Prepaid power,<br />in seconds</h1>
          <p className="lp-hero2-sub">Lipa na M-PESA → Pay Bill <b>{PAYBILL}</b>, account: <b>your meter number</b>. Your token arrives by SMS before you’ve put your phone down.</p>
          <div className="lp-hero2-cta">
            <Link to="/buy" className="lp-get-started">
              <span className="lp-get-started-ico"><Zap size={15} fill="currentColor" /></span>
              Buy tokens
            </Link>
            <Link to={dashboard} className="lp-login-link">
              {user ? 'Go to your dashboard' : 'Log in to the dashboard'}
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-statement" id="features">
        <h2 className="lp-statement-title">Just pay.</h2>
        <p className="lp-statement-sub">
          Enter your meter number and approve on M-Pesa. <b>{APP_NAME} turns the payment into a token</b> and texts it straight to you.
        </p>
        <Link to="/buy" className="lp-dark-pill">Buy tokens now <ArrowRight size={16} /></Link>

        <div className="lp-feature-row">
          {FEATURES.map(({ Icon, lead, rest, text }) => (
            <div key={lead} className="lp-feature">
              <span className="lp-feature-ico"><Icon size={19} /></span>
              <h3>{lead} <span>{rest}</span></h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-privacy2" id="why">
        <div className="lp-privacy2-head">
          <Zap size={22} />
          <h2 className="lp-privacy2-title">
            Reliable <strong>by default.</strong><br />Built <strong>for every meter.</strong>
          </h2>
        </div>
        <PromiseCarousel />
      </section>

      <TrackSection />
      <EnquirySection />

      <footer>
        <div className="lp-wordmark-wrap" aria-hidden="true">
          <span className="wordmark lp-wordmark-giant" aria-hidden="true">TokenPap</span>
        </div>
        <div className="lp-foot">
          <div className="lp-foot-brand">
            <LogoLockup height={58} />
            <p className="lp-foot-title">Top up with {APP_NAME} today.</p>
            <p className="lp-foot-sub">Smart metering and token vending for homes, landlords and vendors.</p>
            <Link to="/buy" className="lp-foot-cta"><Zap size={14} /> Buy tokens</Link>
            <p className="lp-foot-copy">© {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
          </div>
          <div className="lp-foot-col">
            <b>Customers</b>
            <Link to="/buy"><ShoppingCart size={18} aria-hidden="true" />Buy tokens</Link>
            <Link to="/track-token"><Search size={18} aria-hidden="true" />Track a token</Link>
            <Link to="/login"><LogIn size={18} aria-hidden="true" />Customer sign in</Link>
          </div>
          <div className="lp-foot-col">
            <b>Partners</b>
            <Link to="/register"><Store size={18} aria-hidden="true" />Become a vendor</Link>
            <Link to="/login"><Building2 size={18} aria-hidden="true" />Vendor &amp; landlord sign in</Link>
            <a href="#contact"><Gauge size={18} aria-hidden="true" />Get meters installed</a>
          </div>
          <div className="lp-foot-col">
            <b>Support</b>
            <Link to="/help"><LifeBuoy size={18} aria-hidden="true" />Help center</Link>
            <Link to="/privacy"><ShieldCheck size={18} aria-hidden="true" />Privacy policy</Link>
            <Link to="/terms"><FileText size={18} aria-hidden="true" />Terms of service</Link>
            <a href="mailto:info@tokenpap.com"><Mail size={18} aria-hidden="true" />info@tokenpap.com</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
