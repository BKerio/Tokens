import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, Eye, EyeOff } from 'lucide-react';
import { login, sendCustomerOtp, sendTenantOtp, verifyCustomerOtp, verifyTenantOtp, googleSignInUrl, type Session } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { homePath } from '@/lib/session';
import AppLoader from '@/components/shared/AppLoader';
import { LogoLockup } from '@/components/brand/Logo';
import type { User } from '@/types/api';

type Mode = 'account' | 'customer' | 'tenant';

/**
 * Soft, centred card on a quiet page with a slim top bar - shared by the login,
 * registration and password-reset screens. `footer` replaces the terms line under the card.
 */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="au-page">
      <header className="au-top">
        <Link to="/" aria-label="TokenPap home"><LogoLockup height={34} /></Link>
        <nav>
          <Link to="/buy">Buy tokens</Link>
          <Link to="/register">Become a vendor</Link>
        </nav>
      </header>
      <main className="au-main">
        <div className="au-card fade-up">
          <h1 className="au-title">{title}</h1>
          {subtitle && <p className="au-sub">{subtitle}</p>}
          {children}
        </div>
        <p className="au-note">
          {footer ?? <>You acknowledge that you read, and agree to our <Link to="/terms">Terms of Service</Link> and our <Link to="/privacy">Privacy Policy</Link>.</>}
        </p>
      </main>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="alert-error" role="alert" style={{ marginBottom: 16 }}>
      <CircleAlert size={16} />
      <span>{message}</span>
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const [mode, setMode] = useState<Mode>('account');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const finish = (session: Session) => {
    setAuth(session.token, session.user);
    addNotification({ type: 'success', title: 'Signed in', message: `Welcome back, ${session.user.name.split(' ')[0]}.` });
    navigate(homePath(session.user.role), { replace: true });
  };

  // Google sign-in returns here with #token=…&user=… (or #error=…).
  useEffect(() => {
    if (!window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, '', window.location.pathname);
    const token = params.get('token');
    const user = params.get('user');
    if (params.get('error')) {
      setMode('customer');
      setError(params.get('error')!);
    } else if (token && user) {
      try {
        finish({ token, user: JSON.parse(user) as User });
      } catch {
        setError('Google sign-in returned an invalid session.');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const onAccountSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return setError('Enter your email/username and password.');
    void run(async () => finish(await login(identifier.trim(), password)));
  };

  const onCustomerSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!otpSent) {
      if (phone.trim().length < 9) return setError(mode === 'tenant' ? 'Enter the phone number your landlord registered.' : 'Enter the phone number registered with your meter.');
      void run(async () => {
        await (mode === 'tenant' ? sendTenantOtp : sendCustomerOtp)(phone.trim());
        setOtpSent(true);
        addNotification({ type: 'info', title: 'Code sent', message: 'Check your phone for a 6-digit code.' });
      });
    } else {
      if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code we sent you.');
      void run(async () => finish(await (mode === 'tenant' ? verifyTenantOtp : verifyCustomerOtp)(phone.trim(), otp)));
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setOtpSent(false);
    setOtp('');
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle={mode === 'account' ? 'Administrators, vendors and landlords.' : mode === 'tenant' ? 'We\u2019ll text a code to the phone your landlord registered.' : 'We\u2019ll text a one-time code to your phone.'}
    >
      <div className="au-seg" role="tablist" aria-label="Sign in as">
        {([['account', 'Account'], ['customer', 'Customer'], ['tenant', 'Tenant']] as [Mode, string][]).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : undefined} onClick={() => switchMode(m)}>{label}</button>
        ))}
      </div>

      <FormError message={error} />

      {mode === 'account' ? (
        <form onSubmit={onAccountSubmit} className="au-form">
          <div className="au-field">
            <label htmlFor="login-identifier">Email or username</label>
            <input id="login-identifier" className="au-input" autoComplete="username" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. jane@tokenpap.com" />
          </div>
          <div className="au-field">
            <div className="au-label-row">
              <label htmlFor="login-password">Password</label>
              <button type="button" className="au-show" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />} {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input id="login-password" className="au-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters" />
            <Link to="/forgot-password" className="au-link au-forgot">Forgot password?</Link>
          </div>
          <button className="au-btn" disabled={busy} type="submit">
            {busy ? <><AppLoader size={18} /> Signing in…</> : <>Let&rsquo;s go <ArrowRight size={16} /></>}
          </button>
        </form>
      ) : (
        <form onSubmit={onCustomerSubmit} className="au-form">
          <div className="au-field">
            <label htmlFor="login-phone">Phone number</label>
            <input id="login-phone" className="au-input" inputMode="tel" autoComplete="tel" disabled={otpSent} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0712 345 678" />
          </div>
          {otpSent && (
            <div className="au-field">
              <div className="au-label-row">
                <label htmlFor="login-otp">6-digit code</label>
                <button type="button" className="au-show" onClick={() => { setOtpSent(false); setOtp(''); }}>Change number</button>
              </div>
              <input id="login-otp" className="au-input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
            </div>
          )}
          <button className="au-btn" disabled={busy} type="submit">
            {busy ? <AppLoader size={18} /> : otpSent ? <>Verify &amp; sign in <ArrowRight size={16} /></> : <>Send code <ArrowRight size={16} /></>}
          </button>
          {mode === 'customer' && <a className="au-btn ghost" href={googleSignInUrl()}>Continue with Google</a>}
        </form>
      )}
    </AuthCard>
  );
}

export default LoginPage;
