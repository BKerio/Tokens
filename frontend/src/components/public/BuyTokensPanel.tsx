import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, Smartphone } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { stkPush, waitForPayment } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { fmtKes } from '@/lib/format';
import AppLoader from '@/components/shared/AppLoader';
import TokenList from '@/components/public/TokenList';
import type { PaymentStatusResult } from '@/types/api';

type Phase = 'form' | 'waiting' | 'done';

/** Each long-poll waits ~25s server-side; give the payer about two and a half minutes in total. */
const MAX_POLLS = 6;

/**
 * Lipa na M-Pesa: sends an STK push for a meter, then waits for Safaricom's
 * callback and the auto-vended tokens.
 */
function BuyTokensPanel({ defaultMeter = '', defaultPhone = '' }: { defaultMeter?: string; defaultPhone?: string }) {
  const queryClient = useQueryClient();
  const [meter, setMeter] = useState(defaultMeter);
  const [phone, setPhone] = useState(defaultPhone);
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<PaymentStatusResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutId, setCheckoutId] = useState('');

  /** Long-polls until the payment settles or MAX_POLLS run out; a dropped poll is simply retried. */
  const waitFor = async (checkoutRequestId: string) => {
    setPhase('waiting');
    let status: PaymentStatusResult = { status: 'PENDING' };
    for (let i = 0; i < MAX_POLLS && status.status === 'PENDING'; i++) {
      try {
        status = await waitForPayment(checkoutRequestId);
      } catch {
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    setResult(status);
    setPhase('done');
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const value = Number(amount);
    if (!meter.trim()) return setError('Enter the meter number.');
    if (phone.trim().length < 9) return setError('Enter the M-Pesa phone number to charge.');
    if (!(value >= 1)) return setError('Enter an amount of at least KES 1.');
    if (submitting) return;

    // One prompt per tap: a second push while the first is on the phone fails with "Duplicated MSISDN".
    setSubmitting(true);
    let push;
    try {
      push = await stkPush({ phone: phone.trim(), amount: value, reference: meter.trim() });
    } catch (err) {
      setError(errorMessage(err, 'Could not start the M-Pesa payment.'));
      return;
    } finally {
      setSubmitting(false);
    }
    setPrompt(push.customerMessage);
    setCheckoutId(push.checkoutRequestId);
    await waitFor(push.checkoutRequestId);
  };

  const reset = () => {
    setPhase('form');
    setResult(null);
    setAmount('');
  };

  if (phase === 'waiting') {
    return (
      <div className="card-pad col items-center text-center" style={{ gap: 12, padding: '40px 20px' }}>
        <Smartphone size={34} style={{ color: 'var(--green)' }} />
        <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>Check your phone</p>
        <p className="text-sm" style={{ color: 'var(--muted)', maxWidth: 360 }}>
          {prompt || 'Enter your M-Pesa PIN on the prompt we sent'} to pay {fmtKes(amount)} for meter <b className="mono">{meter}</b>.
        </p>
        <AppLoader size={26} />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>Waiting for confirmation - keep this page open.</p>
      </div>
    );
  }

  if (phase === 'done' && result) {
    const ok = result.status === 'CONFIRMED';
    return (
      <div className="card-pad col" style={{ gap: 14 }}>
        <div className="flex items-center gap-2">
          {ok ? <CheckCircle2 size={22} style={{ color: 'var(--color-status-success)' }} /> : <CircleAlert size={22} style={{ color: 'var(--red)' }} />}
          <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>
            {result.status === 'PENDING' ? 'Still waiting for M-Pesa' : ok ? 'Payment received' : 'Payment not completed'}
          </p>
        </div>
        {ok && result.mpesaReceipt && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            M-Pesa receipt <b className="mono">{result.mpesaReceipt}</b> · {fmtKes(result.amount)}
          </p>
        )}
        {ok && result.tokens?.length ? (
          <>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {result.smsSent === false ? 'Enter this token on your meter. We could not SMS it, so note it down now:' : 'Enter this token on your meter (also sent by SMS):'}
            </p>
            <TokenList tokens={result.tokens} />
          </>
        ) : ok ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {result.vendError
              ? 'Your payment was received but the token could not be generated right now. Our team has been notified - you will receive it by SMS.'
              : 'Your token is being generated and will arrive by SMS shortly. You can also look it up under Track token.'}
          </p>
        ) : result.status === 'PENDING' ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>We haven't heard back from M-Pesa yet. If you completed the payment, your token will arrive by SMS.</p>
        ) : (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{result.failureReason ?? 'The transaction failed. Please try again.'}</p>
        )}
        <div className="flex gap-2 flex-wrap">
          {result.status === 'PENDING' && checkoutId && (
            <button className="btn btn-primary" onClick={() => waitFor(checkoutId)}>Check again</button>
          )}
          <button className="btn btn-ghost" onClick={reset}>Buy again</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card-pad col" style={{ gap: 14 }}>
      {error && (
        <div className="alert-error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>
      )}
      <div className="field">
        <label className="label" htmlFor="buy-meter">Meter number</label>
        <input id="buy-meter" className="input mono" inputMode="numeric" value={meter} onChange={(e) => setMeter(e.target.value.trim())} placeholder="e.g. 47500162848" />
      </div>
      <div className="field">
        <label className="label" htmlFor="buy-phone">M-Pesa phone number</label>
        <input id="buy-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
      </div>
      <div className="field">
        <label className="label" htmlFor="buy-amount">Amount (KES)</label>
        <input id="buy-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="500" />
        <div className="flex gap-2 flex-wrap" style={{ marginTop: 6 }}>
          {[100, 200, 500, 1000, 2000].map((v) => (
            <button key={v} type="button" className="btn btn-soft btn-sm" onClick={() => setAmount(String(v))}>{v.toLocaleString()}</button>
          ))}
        </div>
      </div>
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting} aria-busy={submitting}>
        {submitting ? <><AppLoader size={16} /> Sending M-Pesa prompt…</> : 'Pay with M-Pesa'}
      </button>
    </form>
  );
}

export default BuyTokensPanel;
