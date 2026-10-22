import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FlaskConical, Hash, Radio, Smartphone, Store, Zap } from 'lucide-react';
import { testMpesa } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { EmptyState, LoadingBlock } from '@/components/shared/ui';
import {
  CopyButton, FormField, Fieldset, Readiness, SaveBar, SecretField, SectionHead, Segmented, TestConsole, isHttpUrl, isKenyanMobile, type TestResult,
} from './formKit';
import { useConfigForm } from './useConfigForm';

type Env = 'sandbox' | 'live';
type TxType = 'CustomerBuyGoodsOnline' | 'CustomerPayBillOnline';

/** The callback this API exposes, from the frontend's API base URL. */
export const DEFAULT_CALLBACK = `${String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')}/mpesa/callback`;

const digits = (v: string) => /^\d+$/.test(v);

const validate = (v: Record<string, string>) => ({
  mpesa_shortcode: v.mpesa_shortcode && !digits(v.mpesa_shortcode) ? 'Shortcodes are numbers only' : null,
  mpesa_till_no: v.mpesa_till_no && !digits(v.mpesa_till_no) ? 'Till numbers are numbers only' : null,
  mpesa_callback_url: !v.mpesa_callback_url
    ? null
    : !isHttpUrl(v.mpesa_callback_url)
      ? 'Enter a full URL'
      : v.mpesa_env === 'live' && !v.mpesa_callback_url.startsWith('https://')
        ? 'Safaricom only calls https:// URLs in live mode'
        : null,
});

export default function MpesaSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const form = useConfigForm('mpesa', validate);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('1');
  const [results, setResults] = useState<TestResult[]>([]);

  useEffect(() => onDirtyChange(form.dirtyKeys.length > 0), [form.dirtyKeys.length, onDirtyChange]);

  const push = useCallback((r: TestResult) => setResults((prev) => [r, ...prev].slice(0, 4)), []);
  const test = useMutation({
    mutationFn: () => testMpesa({ phone, amount: Number(amount) }),
    onSuccess: (msg) => push({ ok: true, message: msg || 'Prompt sent - check the phone', at: new Date(), target: `${phone} · KES ${amount}` }),
    onError: (err) => push({ ok: false, message: errorMessage(err), at: new Date(), target: `${phone} · KES ${amount}` }),
  });

  if (form.isLoading) return <LoadingBlock height={480} />;
  if (form.configs.length === 0) return <div className="card"><EmptyState title="No M-Pesa settings yet" hint="Run the database seed to create the default keys." /></div>;

  const env = (form.value('mpesa_env') || 'sandbox') as Env;
  const txType = (form.value('mpesa_transaction_type') || 'CustomerBuyGoodsOnline') as TxType;
  const buyGoods = txType === 'CustomerBuyGoodsOnline';
  const callback = form.value('mpesa_callback_url');
  const has = (key: string) => form.isSet(key) || !!form.value(key);
  const field = (key: string) => ({ value: form.value(key), onChange: (e: { target: { value: string } }) => form.set(key, e.target.value.trim()) });

  const readiness = [
    { label: 'Consumer key & secret', ok: has('mpesa_consumer_key') && has('mpesa_consumer_secret'), hint: 'From the Daraja app' },
    { label: 'Passkey', ok: has('mpesa_passkey'), hint: 'Lipa na M-Pesa Online passkey' },
    { label: 'Business shortcode', ok: !!form.value('mpesa_shortcode') && !form.errors.mpesa_shortcode },
    ...(buyGoods ? [{ label: 'Till number', ok: !!form.value('mpesa_till_no') && !form.errors.mpesa_till_no, hint: 'Required for Buy Goods' }] : []),
    { label: 'Callback URL reachable over https', ok: callback.startsWith('https://') && !form.errors.mpesa_callback_url },
  ];

  return (
    <div className="st-section">
      <div className="card st-card">
        <SectionHead
          Icon={Smartphone}
          title="M-Pesa (global)"
          description="The fallback Daraja account for STK pushes on meters whose vendor or landlord has no account of their own."
          aside={<span className={`pill ${env === 'live' ? 'pill-amber' : 'pill-blue'}`}><span className="dot" />{env === 'live' ? 'Live' : 'Sandbox'}</span>}
        />

        <div className="st-body">
          <div className="st-split">
            <div className="st-split-main">
              <Fieldset title="Environment">
                <div className="st-wide">
                  <Segmented<Env>
                    label="M-Pesa environment"
                    value={env}
                    onChange={(v) => form.set('mpesa_env', v)}
                    options={[
                      { value: 'sandbox', title: 'Sandbox', description: 'Test payments, no real money', Icon: FlaskConical },
                      { value: 'live', title: 'Live', description: 'Real customer payments', Icon: Radio, tone: 'warn' },
                    ]}
                  />
                </div>
              </Fieldset>

              <Fieldset title="How customers pay">
                <div className="st-wide">
                  <Segmented<TxType>
                    label="Transaction type"
                    value={txType}
                    onChange={(v) => form.set('mpesa_transaction_type', v)}
                    options={[
                      { value: 'CustomerBuyGoodsOnline', title: 'Buy Goods', description: 'Pays into a till number', Icon: Store },
                      { value: 'CustomerPayBillOnline', title: 'Paybill', description: 'Pays into the shortcode with an account no.', Icon: Hash },
                    ]}
                  />
                </div>
                <FormField label="Business shortcode" required error={form.errors.mpesa_shortcode} hint="Used to sign the STK request">
                  {(a) => <input {...a} className="input mono" inputMode="numeric" {...field('mpesa_shortcode')} />}
                </FormField>
                {buyGoods ? (
                  <FormField label="Till number" required error={form.errors.mpesa_till_no} hint="Where Buy Goods payments land">
                    {(a) => <input {...a} className="input mono" inputMode="numeric" {...field('mpesa_till_no')} />}
                  </FormField>
                ) : (
                  <div className="st-note">Paybill payments go to the shortcode; the meter number is sent as the account number.</div>
                )}
              </Fieldset>

              <Fieldset title="Daraja credentials" hint="From your app on developer.safaricom.co.ke. Stored encrypted; never shown again.">
                <SecretField label="Consumer key" isSet={form.isSet('mpesa_consumer_key')} value={form.value('mpesa_consumer_key')} onChange={(v) => form.set('mpesa_consumer_key', v)} required />
                <SecretField label="Consumer secret" isSet={form.isSet('mpesa_consumer_secret')} value={form.value('mpesa_consumer_secret')} onChange={(v) => form.set('mpesa_consumer_secret', v)} required />
                <SecretField label="Passkey" isSet={form.isSet('mpesa_passkey')} value={form.value('mpesa_passkey')} onChange={(v) => form.set('mpesa_passkey', v)} required />
              </Fieldset>

              <Fieldset title="Callback">
                <FormField
                  label="Callback URL"
                  required
                  wide
                  error={form.errors.mpesa_callback_url}
                  hint={
                    <span className="st-inline-actions">
                      Safaricom posts payment results here.
                      {DEFAULT_CALLBACK.startsWith('http') && callback !== DEFAULT_CALLBACK && (
                        <button type="button" className="st-link-btn" onClick={() => form.set('mpesa_callback_url', DEFAULT_CALLBACK)}>Use this server's URL</button>
                      )}
                      {callback && <CopyButton value={callback} />}
                    </span>
                  }
                >
                  {(a) => <input {...a} className="input mono" inputMode="url" placeholder={DEFAULT_CALLBACK || 'https://'} {...field('mpesa_callback_url')} />}
                </FormField>
              </Fieldset>
            </div>

            <Readiness title="Ready for STK push" items={readiness} />
          </div>
        </div>

        <TestConsole
          title="Send a test STK push"
          description={env === 'live' ? 'Live mode: this charges the phone real money.' : 'Sandbox: use a Safaricom test number.'}
          results={results}
          running={test.isPending}
          runLabel="Send prompt"
          RunIcon={Zap}
          onRun={() => { if (isKenyanMobile(phone) && Number(amount) >= 1) test.mutate(); }}
        >
          <FormField label="Phone" error={phone && !isKenyanMobile(phone) ? 'Enter a Kenyan mobile number' : null}>
            {(a) => <input {...a} className="input" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </FormField>
          <FormField label="Amount (KES)">
            {(a) => <input {...a} className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '') || '')} />}
          </FormField>
        </TestConsole>
      </div>

      <SaveBar count={form.dirtyKeys.length} saving={form.save.isPending} disabled={form.hasErrors} onSave={() => form.save.mutate()} onDiscard={form.reset} />
    </div>
  );
}
