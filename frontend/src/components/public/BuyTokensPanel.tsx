import { useEffect, useState } from 'react';
import { Check, Copy, Gauge, Landmark } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPaybillAccount, stkPush } from '@/api/payments';
import { copyText, fmtKes } from '@/lib/format';
import MpesaPay from '@/components/mpesa/MpesaPay';
import TokenList from '@/components/public/TokenList';

/**
 * "Or pay via the NCBA paybill" with the exact account no. for this meter.
 * NCBA rejects a bare meter number ("invalid account number"): it needs the
 * vendor's till, a #, then the meter number.
 */
function PaybillHint({ meter }: { meter: string }) {
  const [debounced, setDebounced] = useState(meter);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(meter), 450);
    return () => clearTimeout(t);
  }, [meter]);
  const valid = /^\d{6,20}$/.test(debounced);
  const { data, isFetching } = useQuery({
    queryKey: ['paybill-account', debounced],
    queryFn: () => getPaybillAccount(debounced),
    enabled: valid,
    staleTime: 5 * 60_000,
  });

  if (!valid || (!data && isFetching)) return null;
  if (!data) return null;

  return (
    <div className="paybill-hint" aria-live="polite">
      <span className="paybill-hint-ico"><Landmark size={16} /></span>
      <div className="col" style={{ gap: 4, minWidth: 0 }}>
        <b className="text-sm" style={{ color: 'var(--ink)' }}>Or pay with M-Pesa Paybill</b>
        {data.account ? (
          <>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>Business no. <b className="mono" style={{ color: 'var(--ink)' }}>{data.paybill}</b></span>
            <span className="text-sm" style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              Account no. <b className="mono" style={{ color: 'var(--ink)', wordBreak: 'break-all' }}>{data.account}</b>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={async () => { if (await copyText(data.account!)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
              >
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
              </button>
            </span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Type the account exactly as shown, including the #. Just the meter number is rejected.</span>
          </>
        ) : (
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            {data.found ? 'This meter can’t be paid through the paybill yet - use the M-Pesa prompt above.' : 'We couldn’t find this meter. Check the number.'}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Lipa na M-Pesa for a meter, in the shared M-Pesa flow: STK push, then the
 * auto-vended tokens on the receipt (also sent by SMS).
 */
function BuyTokensPanel({ defaultMeter = '', defaultPhone = '' }: { defaultMeter?: string; defaultPhone?: string }) {
  const queryClient = useQueryClient();
  const [meter, setMeter] = useState(defaultMeter);
  const [meterError, setMeterError] = useState('');

  return (
    <MpesaPay
      title="Buy tokens"
      subtitle="Pay with M-Pesa · token sent by SMS"
      fields={(
        <label className="mp-field">
          <span className="mp-label">Meter number</span>
          <span className={`mp-input${meterError ? ' invalid' : ''}`}>
            <Gauge size={20} strokeWidth={1.5} />
            <input className="mono" inputMode="numeric" placeholder="e.g. 47500162848" value={meter} onChange={(e) => { setMeter(e.target.value.replace(/\s/g, '')); setMeterError(''); }} />
          </span>
          {meterError && <span className="mp-error">{meterError}</span>}
        </label>
      )}
      validate={() => {
        const bad = /^\d{6,20}$/.test(meter) ? '' : 'Enter the meter number (digits only).';
        setMeterError(bad);
        return bad ? 'Check the meter number.' : null;
      }}
      defaultPhone={defaultPhone}
      phoneLabel="M-Pesa phone number"
      presets={[100, 200, 500, 1000, 2000].map((v) => ({ label: v.toLocaleString(), amount: v }))}
      start={(phone, amount) => stkPush({ phone, amount, reference: meter })}
      recipient={{ name: 'TokenPap', detail: `Tokens for meter ${meter}` }}
      waitingText="Enter your M-Pesa PIN on the prompt…"
      successRows={(r, ctx) => [
        { label: 'Receipt no.', value: <span className="mono">{r.mpesaReceipt ?? 'Arriving shortly'}</span> },
        { label: 'Amount paid', value: fmtKes(r.amount ?? ctx.amount), strong: true },
        { label: 'Paid from', value: ctx.phone },
        { label: 'Meter', value: <span className="mono">{meter}</span> },
      ]}
      successExtra={(r) => (
        <div className="col" style={{ gap: 8, width: '100%', textAlign: 'left' }}>
          {r.tokens?.length ? (
            <>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)', margin: 0 }}>
                {r.smsSent === false ? 'Enter this token on your meter. We could not SMS it, so note it down now:' : 'Enter this token on your meter (also sent by SMS):'}
              </p>
              <TokenList tokens={r.tokens} />
            </>
          ) : (
            <p className="mp-help">
              {r.vendError
                ? 'Your payment was received but the token could not be generated right now. Our team has been notified - you will receive it by SMS.'
                : 'Your token is being generated and will arrive by SMS shortly. You can also look it up under Track token.'}
            </p>
          )}
        </div>
      )}
      doneLabel="Buy again"
      onDone={() => {
        queryClient.invalidateQueries({ queryKey: ['me'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
      }}
      footer={<div style={{ marginTop: 16 }}><PaybillHint meter={meter.trim()} /></div>}
    />
  );
}

export default BuyTokensPanel;
