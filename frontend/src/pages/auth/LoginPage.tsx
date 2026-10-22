import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, Eye, EyeOff, KeyRound, Lock, Phone, ShieldCheck, User as UserIcon } from 'lucide-react';
import { login, sendCustomerOtp, verifyCustomerOtp, googleSignInUrl, type Session } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { homePath } from '@/lib/session';
import AppLoader from '@/components/shared/AppLoader';
import { LogoLockup } from '@/components/brand/Logo';
import type { User } from '@/types/api';

type Mode = 'account' | 'customer';

/** Branded card shell shared by the login, registration and password-reset screens. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="login-page">
      <div className="login-card fade-up">
        <Link to="/" className="login-cobrand" style={{ justifyContent: 'center', textDecoration: 'none' }}>
          <LogoLockup height={54} />
        </Link>
        <div className="login-body">
          <h1 className="login-title">{title}</h1>
          <p className="login-sub">{subtitle}</p>
          {children}
        </div>
        <div className="login-foot">
          {footer ?? (<><ShieldCheck size={15} /> Secure sign-in · All activity is logged and audited</>)}
        </div>
      </div>
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
      if (phone.trim().length < 9) return setError('Enter the phone number registered with your meter.');
      void run(async () => {
        await sendCustomerOtp(phone.trim());
        setOtpSent(true);
        addNotification({ type: 'info', title: 'Code sent', message: 'Check your phone for a 6-digit code.' });
      });
    } else {
      if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code we sent you.');
      void run(async () => finish(await verifyCustomerOtp(phone.trim(), otp)));
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
  };

  return (
    <AuthCard
      title="Sign in"
      subtitle={mode === 'account' ? 'Administrators, vendors and landlords.' : 'Customers sign in with a one-time code sent to their phone.'}
    >
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button type="button" className={`tab${mode === 'account' ? ' on' : ''}`} onClick={() => switchMode('account')}>Staff &amp; partners</button>
        <button type="button" className={`tab${mode === 'customer' ? ' on' : ''}`} onClick={() => switchMode('customer')}>Customer</button>
      </div>

      <FormError message={error} />

      {mode === 'account' ? (
        <form onSubmit={onAccountSubmit} className="col" style={{ gap: 16 }}>
          <div className="field">
            <label className="label" htmlFor="login-identifier">Email, username or vendor account ID</label>
            <div className="input-icon">
              <input id="login-identifier" className="input" autoComplete="username" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@example.com" />
              <UserIcon size={16} />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="login-password">Password</label>
            <div className="input-icon has-toggle">
              <input id="login-password" className="input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="************" />
              <Lock size={16} />
              <button type="button" className="field-toggle" onClick={() => setShowPassword((v) => !v)} tabIndex={-1} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="flex justify-between text-sm">
            <Link to="/forgot-password" style={{ color: 'var(--green)', fontWeight: 600 }}>Forgot password?</Link>
            <Link to="/register" style={{ color: 'var(--green)', fontWeight: 600 }}>Become a vendor</Link>
          </div>
          <button className="btn btn-primary btn-block btn-lg login-submit" disabled={busy} type="submit">
            {busy ? <><AppLoader size={20} /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
          </button>
        </form>
      ) : (
        <form onSubmit={onCustomerSubmit} className="col" style={{ gap: 16 }}>
          <div className="field">
            <label className="label" htmlFor="login-phone">Phone number</label>
            <div className="input-icon">
              <input id="login-phone" className="input" inputMode="tel" autoComplete="tel" disabled={otpSent} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
              <Phone size={16} />
            </div>
          </div>
          {otpSent && (
            <div className="field">
              <label className="label" htmlFor="login-otp">6-digit code</label>
              <div className="input-icon">
                <input id="login-otp" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
                <KeyRound size={16} />
              </div>
              <button type="button" className="text-sm" style={{ color: 'var(--green)', fontWeight: 600, textAlign: 'left' }} onClick={() => { setOtpSent(false); setOtp(''); }}>
                Use a different number
              </button>
            </div>
          )}
          <button className="btn btn-primary btn-block btn-lg login-submit" disabled={busy} type="submit">
            {busy ? <AppLoader size={20} /> : otpSent ? <>Verify &amp; sign in <ArrowRight size={16} /></> : <>Send code <ArrowRight size={16} /></>}
          </button>
          <a className="btn btn-ghost btn-block" href={googleSignInUrl()}>Continue with Google</a>
        </form>
      )}
    </AuthCard>
  );
}

export default LoginPage;
