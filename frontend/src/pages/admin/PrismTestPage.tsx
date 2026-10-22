import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, CircleDashed, FlaskConical, Server, XCircle, Zap } from 'lucide-react';
import { runPrismTest } from '@/api/admin';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { fmtTime } from '@/lib/datetime';
import AppLoader from '@/components/shared/AppLoader';
import TokenList from '@/components/public/TokenList';
import { EmptyState, Field, PageHeader } from '@/components/shared/ui';
import type { PrismControlType, PrismTestResult, PrismTestStep } from '@/types/api';

type TokenOption = 'CREDIT' | PrismControlType;

const OPTIONS: { value: TokenOption; label: string; help: string }[] = [
  { value: 'CREDIT', label: 'Credit', help: 'Issue a credit token for the amount below.' },
  { value: 'CLEAR_TAMPER', label: 'Clear tamper', help: 'Control token that clears the tamper state (TOKEN_CONTROL_CLEAR_TAMPER_* mapping).' },
  { value: 'CLEAR_CREDIT', label: 'Clear credit', help: 'Control token that clears stored credit (TOKEN_CONTROL_CLEAR_CREDIT_* mapping).' },
  { value: 'SET_MAX_OVERDRAFT', label: 'Max overdraft', help: 'Control token that sets the overdraft limit (TOKEN_CONTROL_MAX_OVERDRAFT_* mapping).' },
];

const SOURCE_LABEL: Record<PrismTestResult['source'], string> = {
  database: 'Meter found in the database - its STS values were used',
  defaults: 'Meter not in the database - legacy test values were used',
  raw: 'Raw mode - legacy test values, Vending Control ignored',
};

function StepRow({ step, index }: { step: PrismTestStep; index: number }) {
  const icon =
    step.status === 'ok' ? <CheckCircle2 size={18} style={{ color: 'var(--color-status-success)' }} /> :
    step.status === 'failed' ? <XCircle size={18} style={{ color: 'var(--red)' }} /> :
    <CircleDashed size={18} style={{ color: 'var(--muted)' }} />;
  return (
    <div className="flex items-start gap-3" style={{ padding: '10px 0', borderTop: index ? '1px solid var(--border)' : undefined, opacity: step.status === 'skipped' ? 0.55 : 1 }}>
      <span style={{ marginTop: 1 }}>{icon}</span>
      <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <div className="flex justify-between gap-2">
          <b className="text-sm" style={{ color: 'var(--ink)' }}>{index + 1}. {step.label}</b>
          <span className="text-xs mono" style={{ color: 'var(--muted)' }}>{step.status === 'skipped' ? 'skipped' : `${step.ms} ms`}</span>
        </div>
        {step.detail && (
          <span className="text-xs" style={{ color: step.status === 'failed' ? 'var(--red)' : 'var(--muted)', wordBreak: 'break-word' }}>{step.detail}</span>
        )}
      </div>
    </div>
  );
}

function ResultCard({ r }: { r: PrismTestResult }) {
  const defaults = Object.entries(r.vendingDefaults);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card card-pad flex items-center gap-3" style={{ borderColor: r.ok ? 'var(--color-status-success)' : 'var(--red)', background: r.ok ? 'color-mix(in srgb, var(--color-status-success) 8%, var(--surface))' : 'color-mix(in srgb, var(--red) 6%, var(--surface))' }}>
        {r.ok ? <CheckCircle2 size={24} style={{ color: 'var(--color-status-success)' }} /> : <CircleAlert size={24} style={{ color: 'var(--red)' }} />}
        <div className="col" style={{ gap: 2 }}>
          <b style={{ color: 'var(--ink)' }}>{r.ok ? 'SUCCESS: Tokens generated' : 'FAILED'}</b>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            Meter <span className="mono">{r.meterNumber}</span> · {r.tokenType === 'CREDIT' ? `credit ${r.amount}` : `${r.tokenType.replace(/_/g, ' ').toLowerCase()}${r.controlValue !== null ? ` (${r.controlValue})` : ''}`} · {r.durationMs} ms
          </span>
        </div>
      </div>

      {r.ok && (
        <div className="card">
          <div className="card-head"><span className="card-title flex items-center gap-2"><Zap size={16} /> STS token{r.tokens.length > 1 ? 's' : ''}</span></div>
          <div className="card-pad col" style={{ gap: 10 }}>
            <TokenList tokens={r.tokens.map((t) => t.token)} />
            {r.tokens.map((t, i) => (t.description || t.quantity) && (
              <span key={i} className="text-sm" style={{ color: 'var(--muted)' }}>({i + 1}) {[t.description, t.quantity].filter(Boolean).join(' · ')}</span>
            ))}
          </div>
        </div>
      )}

      {r.error && (
        <div className="card card-pad col" style={{ gap: 6 }}>
          <b className="text-sm" style={{ color: 'var(--red)' }}>{r.error.message}</b>
          {r.error.code && (
            <span className="text-sm" style={{ color: 'var(--ink)' }}>
              Prism code <span className="mono">{r.error.code}</span>{r.error.details ? ` - ${r.error.details}` : ''}
            </span>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head"><span className="card-title">Steps</span></div>
        <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {r.steps.map((s, i) => <StepRow key={s.key} step={s} index={i} />)}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><span className="card-title flex items-center gap-2"><Server size={16} /> Meter config sent to Prism</span></div>
        <div className="card-pad col" style={{ gap: 12 }}>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            {SOURCE_LABEL[r.source]}
            {r.meter && <> ({r.meter.owner ?? 'unassigned'} · {r.meter.type} · {r.meter.status})</>}
          </span>
          {r.sts && (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))' }}>
              {(['sgc', 'krn', 'ti', 'ea', 'tct', 'ken'] as const).map((k) => (
                <div key={k} className="card card-pad col" style={{ gap: 2, boxShadow: 'none', padding: '10px 12px' }}>
                  <span className="eyebrow" style={{ fontSize: 10 }}>{k.toUpperCase()}</span>
                  <b className="mono" style={{ color: 'var(--ink)' }}>{r.sts![k]}</b>
                </div>
              ))}
            </div>
          )}
          {r.source !== 'raw' && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Vending Control defaults: {defaults.length ? defaults.map(([k, v]) => `${k.replace('vending_', '').toUpperCase()}=${v}`).join(', ') : 'none set'} (the meter's own values win)
            </span>
          )}
          <span className="text-xs mono" style={{ color: 'var(--muted)' }}>
            Prism {r.prism.host} · port {r.prism.port}{r.messageId ? ` · message ${r.messageId}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function PrismTestPage() {
  const [meterNumber, setMeterNumber] = useState('47500162848');
  const [option, setOption] = useState<TokenOption>('CREDIT');
  const [amount, setAmount] = useState('10');
  const [value, setValue] = useState('');
  const [raw, setRaw] = useState(false);
  const [history, setHistory] = useState<PrismTestResult[]>([]);
  const [selected, setSelected] = useState(0);

  const test = useMutation({
    mutationFn: runPrismTest,
    onSuccess: (r) => {
      setHistory((h) => [r, ...h].slice(0, 10));
      setSelected(0);
      notify(r.ok ? 'success' : 'error', r.ok ? 'Token generated' : 'Prism test failed', r.ok ? undefined : r.error?.message);
    },
    onError: (err) => notify('error', 'Could not run the test', errorMessage(err)),
  });

  const help = OPTIONS.find((o) => o.value === option)!.help;
  const current = history[selected];

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6,20}$/.test(meterNumber.trim())) return notify('warning', 'Enter a valid meter number', '6-20 digits.');
    if (option === 'CREDIT' && !(Number(amount) > 0)) return notify('warning', 'Enter an amount greater than 0');
    const ok = await confirmDialog({
      title: 'Issue a real test token?',
      text: `This contacts the live Prism network and issues a real ${option === 'CREDIT' ? 'credit' : 'control'} token for meter ${meterNumber.trim()}. No transaction is recorded and no SMS is sent; the run is audit-logged.`,
      confirmLabel: 'Run test',
    });
    if (!ok) return;
    test.mutate({
      meterNumber: meterNumber.trim(),
      ...(option === 'CREDIT' ? { amount: Number(amount) } : { control: option }),
      ...(option === 'SET_MAX_OVERDRAFT' && value !== '' ? { value: Number(value) } : {}),
      raw,
    });
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="System"
        title="Prism test"
        subtitle="Check the connection to the Prism STS vending network by generating a token - the same test as `npm run prism:test` on the server."
      />

      <div className="prism-grid">
        <div className="col" style={{ gap: 20, minWidth: 0 }}>
          <form className="card" onSubmit={onSubmit}>
            <div className="card-head"><span className="card-title flex items-center gap-2"><FlaskConical size={16} /> Test parameters</span></div>
            <div className="card-pad col" style={{ gap: 14 }}>
              <Field label="Meter number (DRN)" hint="Defaults to the legacy test meter.">
                <input className="input mono" inputMode="numeric" value={meterNumber} onChange={(e) => setMeterNumber(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <Field label="Token" hint={help}>
                <select className="eoc-select" value={option} onChange={(e) => setOption(e.target.value as TokenOption)}>
                  {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              {option === 'CREDIT' && (
                <Field label="Amount" hint="Sent to Prism as the transfer amount, as a live vend does.">
                  <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
                </Field>
              )}
              {option === 'SET_MAX_OVERDRAFT' && (
                <Field label="Overdraft value" hint="Leave blank to use the server default.">
                  <input className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
                </Field>
              )}
              <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} style={{ marginTop: 3 }} />
                <span>Raw mode<br /><span className="text-xs" style={{ color: 'var(--muted)' }}>Ignore the database and Vending Control; use the legacy test values (SGC 600909, KRN 1, TI 1, EA 7, KEN 255).</span></span>
              </label>
              <button className="btn btn-primary btn-block" type="submit" disabled={test.isPending}>
                {test.isPending ? <><AppLoader size={16} /> Contacting Prism…</> : <><Zap size={16} /> Run test</>}
              </button>
            </div>
          </form>

          {history.length > 0 && (
            <div className="card">
              <div className="card-head"><span className="card-title">This session</span></div>
              <div className="col">
                {history.map((h, i) => (
                  <button
                    key={h.startedAt + i}
                    type="button"
                    onClick={() => setSelected(i)}
                    className="flex items-center justify-between gap-2 card-pad"
                    style={{ textAlign: 'left', borderTop: i ? '1px solid var(--border)' : undefined, background: i === selected ? 'var(--green-light)' : 'transparent' }}
                  >
                    <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                      {h.ok ? <CheckCircle2 size={14} style={{ color: 'var(--color-status-success)' }} /> : <XCircle size={14} style={{ color: 'var(--red)' }} />}
                      <span className="mono">{h.meterNumber}</span> · {h.tokenType === 'CREDIT' ? `credit ${h.amount}` : h.tokenType.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{fmtTime(h.startedAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="col" style={{ gap: 20, minWidth: 0 }}>
          {test.isPending ? (
            <div className="card card-pad flex flex-col items-center justify-center" style={{ minHeight: 260, gap: 12, color: 'var(--green)' }}>
              <AppLoader size={34} label="Contacting Prism" />
              <span className="text-sm" style={{ color: 'var(--muted)' }}>Connecting, authenticating and generating…</span>
            </div>
          ) : current ? (
            <ResultCard r={current} />
          ) : (
            <div className="card">
              <EmptyState icon={<FlaskConical size={28} />} title="No test run yet" hint="Set the parameters and run a test to see each step and the generated token." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PrismTestPage;
