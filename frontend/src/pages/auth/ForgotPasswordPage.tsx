import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { resetPassword, sendResetCode, verifyResetCode } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import AppLoader from '@/components/shared/AppLoader';
import { AuthCard, FormError } from '@/pages/auth/LoginPage';

type Step = 'request' | 'verify' | 'reset';

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('request');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step === 'request') {
      if (identifier.trim().length < 3) return setError('Enter your email address or phone number.');
      void run(async () => {
        const message = await sendResetCode(identifier.trim());
        notify('info', 'Check your inbox', message);
        setStep('verify');
      });
    } else if (step === 'verify') {
      if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code.');
      void run(async () => {
        await verifyResetCode(identifier.trim(), otp);
        setStep('reset');
      });
    } else {
      if (password.length < 8) return setError('Password must be at least 8 characters.');
      if (password !== confirm) return setError("Passwords don't match.");
      void run(async () => {
        await resetPassword(identifier.trim(), otp, password);
        notify('success', 'Password reset', 'You can now sign in with your new password.');
        navigate('/login');
      });
    }
  };

  const copy: Record<Step, { title: string; subtitle: string; button: string }> = {
    request: { title: 'Reset your password', subtitle: "Enter your account email or phone and we'll send you a code.", button: 'Send code' },
    verify: { title: 'Enter your code', subtitle: `We sent a 6-digit code to ${identifier}. It expires in 10 minutes.`, button: 'Verify code' },
    reset: { title: 'Choose a new password', subtitle: 'Use at least 8 characters.', button: 'Reset password' },
  };

  return (
    <AuthCard title={copy[step].title} subtitle={copy[step].subtitle} footer={<Link to="/login" style={{ color: 'var(--green)', fontWeight: 600 }}>Back to sign in</Link>}>
      <FormError message={error} />
      <form onSubmit={onSubmit} className="col" style={{ gap: 16 }}>
        {step === 'request' && (
          <div className="field">
            <label className="label" htmlFor="fp-id">Email or phone</label>
            <input id="fp-id" className="input" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@example.com or 0712 345 678" />
          </div>
        )}
        {step === 'verify' && (
          <div className="field">
            <label className="label" htmlFor="fp-otp">Verification code</label>
            <input id="fp-otp" className="input mono" inputMode="numeric" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
          </div>
        )}
        {step === 'reset' && (
          <>
            <div className="field">
              <label className="label" htmlFor="fp-pw">New password</label>
              <input id="fp-pw" className="input" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="fp-pw2">Confirm password</label>
              <input id="fp-pw2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </>
        )}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
          {busy ? <AppLoader size={20} /> : <>{copy[step].button} <ArrowRight size={16} /></>}
        </button>
      </form>
    </AuthCard>
  );
}

export default ForgotPasswordPage;
