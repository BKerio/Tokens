import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageSquareText, Send, Signal } from 'lucide-react';
import { testSms } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { EmptyState, LoadingBlock } from '@/components/shared/ui';
import { FormField, Fieldset, SaveBar, SecretField, SectionHead, Switch, TestConsole, isHttpUrl, isKenyanMobile, type TestResult } from './formKit';
import { useConfigForm } from './useConfigForm';

const PROVIDERS = ['advanta', 'fornax', 'africastalking', 'celcom'];

const validate = (v: Record<string, string>) => ({
  sms_api_url: v.sms_api_url && !isHttpUrl(v.sms_api_url) ? 'Enter a full URL starting with https://' : null,
  sms_shortcode: v.sms_shortcode && v.sms_shortcode.length > 11 ? 'Sender IDs are at most 11 characters' : null,
});

/** What the customer will see - a phone notification using the sender ID being edited. */
function SmsPreview({ sender, body }: { sender: string; body: string }) {
  return (
    <figure className="st-sms-preview" aria-label="SMS preview">
      <div className="st-sms-phone">
        <div className="st-sms-top"><Signal size={11} /> 9:41</div>
        <div className="st-sms-sender">
          <span>{(sender || 'TokenPap').slice(0, 1).toUpperCase()}</span>
          <b>{sender || 'Sender ID'}</b>
          <small>Text message · now</small>
        </div>
        <p className="st-sms-bubble">{body || 'Your message will appear here.'}</p>
      </div>
      <figcaption>Live preview with your sender ID</figcaption>
    </figure>
  );
}

export default function SmsSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const form = useConfigForm('sms', validate);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('Test message from TokenPap.');
  const [results, setResults] = useState<TestResult[]>([]);

  useEffect(() => onDirtyChange(form.dirtyKeys.length > 0), [form.dirtyKeys.length, onDirtyChange]);

  const push = useCallback((r: TestResult) => setResults((prev) => [r, ...prev].slice(0, 4)), []);
  const test = useMutation({
    mutationFn: () => testSms({ phone, message }),
    onSuccess: (msg) => push({ ok: true, message: msg || 'SMS accepted by the gateway', at: new Date(), target: phone }),
    onError: (err) => push({ ok: false, message: errorMessage(err), at: new Date(), target: phone }),
  });

  if (form.isLoading) return <LoadingBlock height={420} />;
  if (form.configs.length === 0) return <div className="card"><EmptyState title="No SMS settings yet" hint="Run the database seed to create the default keys." /></div>;

  const enabled = form.value('sms_enabled') === 'true';
  const field = (key: string) => ({ value: form.value(key), onChange: (e: { target: { value: string } }) => form.set(key, e.target.value) });

  return (
    <div className="st-section">
      <div className="card st-card">
        <SectionHead
          Icon={MessageSquareText}
          title="SMS gateway"
          description="Delivers tokens, payment receipts and one-time passwords. Vendors with their own sender ID override this."
          aside={<span className={`pill ${enabled ? 'pill-green' : 'pill-gray'}`}><span className="dot" />{enabled ? 'Sending' : 'Paused'}</span>}
        />

        <div className="st-body">
          <Switch
            checked={enabled}
            onChange={(on) => form.set('sms_enabled', on ? 'true' : 'false')}
            label="Send SMS"
            description={enabled ? 'Customers receive their tokens by SMS as soon as they are generated.' : 'No SMS will be sent - customers must look tokens up on the website.'}
            tone={enabled ? undefined : 'warn'}
          />

          <div className="st-split">
            <div className="st-split-main">
              <Fieldset title="Provider" hint="The bulk-SMS company TokenPap sends through.">
                <FormField label="Provider" hint="e.g. advanta">
                  {(a) => (
                    <>
                      <input {...a} className="input" list="sms-providers" {...field('sms_provider')} />
                      <datalist id="sms-providers">{PROVIDERS.map((p) => <option key={p} value={p} />)}</datalist>
                    </>
                  )}
                </FormField>
                <FormField label="API endpoint" error={form.errors.sms_api_url} hint="The provider's send-SMS URL" wide>
                  {(a) => <input {...a} className="input mono" inputMode="url" placeholder="https://" {...field('sms_api_url')} />}
                </FormField>
              </Fieldset>

              <Fieldset title="Account" hint="From your provider's dashboard.">
                <FormField label="Partner ID">
                  {(a) => <input {...a} className="input mono" {...field('sms_partner_id')} />}
                </FormField>
                <FormField label="Sender ID" error={form.errors.sms_shortcode} hint="Shown as the SMS sender (max 11 characters)">
                  {(a) => <input {...a} className="input" maxLength={11} {...field('sms_shortcode')} />}
                </FormField>
                <SecretField label="API key" isSet={form.isSet('sms_api_key')} value={form.value('sms_api_key')} onChange={(v) => form.set('sms_api_key', v)} />
              </Fieldset>
            </div>

            <SmsPreview sender={form.value('sms_shortcode')} body={message} />
          </div>
        </div>

        <TestConsole
          title="Send a test SMS"
          description={form.dirtyKeys.length ? 'Save first - the test uses the stored settings.' : 'Uses the saved settings above.'}
          results={results}
          running={test.isPending}
          runLabel="Send test"
          RunIcon={Send}
          onRun={() => { if (isKenyanMobile(phone) && message.trim()) test.mutate(); }}
        >
          <FormField label="Phone" error={phone && !isKenyanMobile(phone) ? 'Enter a Kenyan mobile number' : null}>
            {(a) => <input {...a} className="input" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </FormField>
          <FormField label="Message" hint={`${message.length}/160`} wide>
            {(a) => <input {...a} className="input" maxLength={160} value={message} onChange={(e) => setMessage(e.target.value)} />}
          </FormField>
        </TestConsole>
      </div>

      <SaveBar count={form.dirtyKeys.length} saving={form.save.isPending} disabled={form.hasErrors} onSave={() => form.save.mutate()} onDiscard={form.reset} />
    </div>
  );
}
