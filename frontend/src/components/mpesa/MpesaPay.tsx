import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Coins, Info, RotateCcw, Smartphone, X } from 'lucide-react';
import { waitForPayment } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { fmtKes } from '@/lib/format';
import type { PaymentStatusResult } from '@/types/api';

/** Each long-poll waits ~25s server-side (the server also asks Daraja directly); ~2.5 min in total. */
const MAX_POLLS = 6;
const SAFARICOM_RE = /^(?:\+?254|0)?[17]\d{8}$/;

export const isSafaricomNumber = (v: string) => SAFARICOM_RE.test(v.replace(/[\s-]/g, ''));

export interface MpesaStart { checkoutRequestId: string; customerMessage?: string; phone?: string }
export interface MpesaRow { label: string; value: ReactNode; strong?: boolean }

type Phase = 'form' | 'progress' | 'success' | 'failed' | 'pending';

/**
 * The one M-Pesa (STK push) flow used across the app:
 * form → "Transfer in progress" (From / To) → "Transfer completed" receipt,
 * or a failed / still-waiting card with a way forward.
 */
export default function MpesaPay({
  title = 'Pay with M-Pesa',
  subtitle = 'Secure payment via STK Push',
  context,
  fields,
  footer,
  defaultPhone = '',
  phoneLabel = 'Phone number',
  defaultAmount = '',
  presets = [],
  payLabel = (a) => `Pay ${a ? fmtKes(a) : 'KES 0'}`,
  validate,
  start,
  fromLabel = 'Safaricom M-Pesa account',
  recipient,
  waitingText = 'Awaiting M-Pesa PIN on the phone…',
  successRows,
  successExtra,
  doneLabel = 'Done',
  onDone,
  onBack,
}: {
  title?: string;
  subtitle?: string;
  /** Summary box above the form (who / what is being paid). */
  context?: { label: string; title: string; sub?: string; right?: { label: string; value: ReactNode } };
  /** Extra inputs shown above the phone number (meter, purpose…). */
  fields?: ReactNode;
  /** Shown under the pay button. */
  footer?: ReactNode;
  defaultPhone?: string;
  phoneLabel?: string;
  defaultAmount?: string;
  presets?: { label: string; amount: number }[];
  payLabel?: (amount: number) => string;
  /** Extra validation for `fields`; return a message to block submit. */
  validate?: () => string | null;
  start: (phone: string, amount: number) => Promise<MpesaStart>;
  fromLabel?: string;
  /** "To" card: who receives the money. */
  recipient: { name: string; detail: string };
  waitingText?: string;
  successRows?: (r: PaymentStatusResult, ctx: { phone: string; amount: number }) => MpesaRow[];
  successExtra?: (r: PaymentStatusResult) => ReactNode;
  doneLabel?: string;
  onDone?: (r: PaymentStatusResult | null) => void;
  onBack?: () => void;
}) {
  const [phone, setPhone] = useState(defaultPhone);
  const [amount, setAmount] = useState(defaultAmount);
  const [phase, setPhase] = useState<Phase>('form');
  const [errors, setErrors] = useState<{ phone?: string; amount?: string; form?: string }>({});
  const [sending, setSending] = useState(false);
  const [checkout, setCheckout] = useState<MpesaStart | null>(null);
  const [result, setResult] = useState<PaymentStatusResult | null>(null);
  const alive = useRef(true);
  // Re-armed on every mount (React remounts components in development).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const value = Math.floor(Number(amount) || 0);

  const poll = async (id: string) => {
    setPhase('progress');
    let status: PaymentStatusResult = { status: 'PENDING' };
    for (let i = 0; i < MAX_POLLS && status.status === 'PENDING' && alive.current; i++) {
      try {
        status = await waitForPayment(id);
      } catch {
        await new Promise((r) => setTimeout(r, 2_000)); // dropped poll: try again
      }
    }
    if (!alive.current) return;
    setResult(status);
    setPhase(status.status === 'CONFIRMED' ? 'success' : status.status === 'FAILED' ? 'failed' : 'pending');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const next: typeof errors = {};
    if (!isSafaricomNumber(phone)) next.phone = 'Enter a valid Safaricom number, e.g. 0712345678';
    if (!(value >= 1)) next.amount = 'Enter an amount of at least KES 1';
    const extra = validate?.();
    if (extra) next.form = extra;
    setErrors(next);
    if (Object.keys(next).length) return;

    // One prompt per tap: a second push while the first is on the phone fails with "Duplicated MSISDN".
    setSending(true);
    try {
      const started = await start(phone.replace(/[\s-]/g, ''), value);
      setCheckout(started);
      await poll(started.checkoutRequestId);
    } catch (err) {
      setErrors({ form: errorMessage(err, 'Could not send the M-Pesa prompt.') });
      setPhase('form');
    } finally {
      if (alive.current) setSending(false);
    }
  };

  const reset = () => { setPhase('form'); setResult(null); setCheckout(null); setErrors({}); };
  const shownPhone = checkout?.phone ? `0${checkout.phone.slice(-9)}` : phone;

  // ── Transfer completed ───────────────────────────────────────────────────
  if (phase === 'success' && result) {
    const rows = successRows?.(result, { phone: shownPhone, amount: value }) ?? [
      { label: 'Receipt no.', value: <span className="mono">{result.mpesaReceipt ?? 'Pending'}</span> },
      { label: 'Amount paid', value: fmtKes(result.amount ?? value), strong: true },
      { label: 'Phone', value: shownPhone },
    ];
    return (
      <div className="mp-card mp-center">
        <span className="mp-ring done"><Check size={38} strokeWidth={3} /></span>
        <div className="mp-heading">
          <h2>Transfer completed</h2>
          <p className="mp-accent">{result.mpesaReceipt ? <>Transaction ID: <span className="mono">{result.mpesaReceipt}</span></> : 'Confirmed by M-Pesa'}</p>
        </div>
        <div className="mp-receipt">
          {rows.map((r, i) => (
            <div key={r.label} className={`mp-receipt-row${i > 0 && rows[i - 1]?.strong !== r.strong ? ' sep' : ''}`}>
              <span>{r.label}</span><b className={r.strong ? 'big' : undefined}>{r.value}</b>
            </div>
          ))}
        </div>
        {successExtra?.(result)}
        <button type="button" className="mp-btn" onClick={() => { onDone?.(result); reset(); }}>{doneLabel}</button>
      </div>
    );
  }

  // ── Failed / still waiting ─────────────────────────────────────────────
  if ((phase === 'failed' || phase === 'pending') && result) {
    const failed = phase === 'failed';
    return (
      <div className="mp-card mp-center">
        <span className={`mp-ring ${failed ? 'bad' : 'wait'}`}>{failed ? <X size={38} strokeWidth={3} /> : <Info size={36} />}</span>
        <div className="mp-heading">
          <h2>{failed ? 'Payment not completed' : 'Still waiting for M-Pesa'}</h2>
          <p className={failed ? 'mp-bad' : 'mp-accent'}>
            {failed ? result.failureReason ?? 'The transaction failed.' : 'We haven’t heard back yet.'}
          </p>
        </div>
        <p className="mp-help">
          {failed
            ? 'No money was taken. Check the phone number and balance, then try again.'
            : 'If the PIN was entered, the payment will still be recorded and an SMS sent once M-Pesa confirms it. Make sure the SIM is on and has network.'}
        </p>
        <div className="mp-btn-row">
          {!failed && checkout && <button type="button" className="mp-btn" onClick={() => poll(checkout.checkoutRequestId)}><RotateCcw size={16} /> Check again</button>}
          <button type="button" className={failed ? 'mp-btn' : 'mp-btn ghost'} onClick={reset}>{failed ? 'Try again' : 'Start over'}</button>
        </div>
      </div>
    );
  }

  // ── Transfer in progress ───────────────────────────────────────────────
  if (phase === 'progress') {
    return (
      <div className="mp-card mp-center" aria-live="polite">
        <span className="mp-ring mp-spinning">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </span>
        <div className="mp-heading">
          <h2>Transfer in progress</h2>
          <p className="mp-accent mp-pulse">Processing transaction…</p>
        </div>
        <div className="mp-leg">
          <span className="mp-leg-label"><ArrowUp size={14} /> From</span>
          <div className="mp-leg-body">
            <span className="mp-av">M</span>
            <span><b>{shownPhone}</b><small>{fromLabel}</small></span>
          </div>
        </div>
        <div className="mp-leg">
          <span className="mp-leg-label"><ArrowDown size={14} /> To</span>
          <div className="mp-leg-body">
            <span className="mp-av ink">{recipient.name.slice(0, 1).toUpperCase()}</span>
            <span><b>{fmtKes(value)}</b><small>{recipient.detail}</small></span>
          </div>
        </div>
        <p className="mp-foot">{waitingText} <Info size={15} /></p>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────
  return (
    <div className="mp-card">
      {onBack && <button type="button" className="mp-back" onClick={onBack} aria-label="Back"><ArrowLeft size={22} /></button>}
      <div className="mp-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      {context && (
        <div className="mp-context">
          <div>
            <span className="mp-kicker">{context.label}</span>
            <b>{context.title}</b>
            {context.sub && <small>{context.sub}</small>}
          </div>
          {context.right && (
            <div className="mp-context-right">
              <span className="mp-kicker">{context.right.label}</span>
              <b>{context.right.value}</b>
            </div>
          )}
        </div>
      )}

      <form onSubmit={submit} noValidate className="mp-form">
        {errors.form && <div className="mp-alert" role="alert">{errors.form}</div>}
        {fields}

        <label className="mp-field">
          <span className="mp-label">{phoneLabel}</span>
          <span className={`mp-input${errors.phone ? ' invalid' : ''}`}>
            <Smartphone size={20} strokeWidth={1.5} />
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="0712345678" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </span>
          {errors.phone && <span className="mp-error">{errors.phone}</span>}
        </label>

        <label className="mp-field">
          <span className="mp-label">Amount (KES)</span>
          <span className={`mp-input${errors.amount ? ' invalid' : ''}`}>
            <Coins size={20} strokeWidth={1.5} />
            <input inputMode="numeric" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
          </span>
          {errors.amount && <span className="mp-error">{errors.amount}</span>}
        </label>
        {presets.length > 0 && (
          <div className="mp-presets">
            {presets.map((p) => (
              <button key={p.label} type="button" className={`mp-preset${value === Math.floor(p.amount) ? ' on' : ''}`} onClick={() => setAmount(String(Math.floor(p.amount)))}>{p.label}</button>
            ))}
          </div>
        )}

        <button type="submit" className="mp-btn" disabled={sending} aria-busy={sending}>
          {sending ? <><span className="mp-spinner" aria-hidden="true" /> Sending prompt…</> : payLabel(value)}
        </button>
      </form>
      {footer}
    </div>
  );
}
