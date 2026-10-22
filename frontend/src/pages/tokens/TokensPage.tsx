import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Building2, CheckCircle2, Copy, Gauge, History, Home, MapPin, Search, ShieldAlert, User as UserIcon, Zap,
} from 'lucide-react';
import { generateToken, listTransactions, meterLookup } from '@/api/meters';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { fmtDateTime, nairobiInputToISO } from '@/lib/datetime';
import { copyText, fmtKes, fmtToken, humanize, statusPill, toNum } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import AppLoader from '@/components/shared/AppLoader';
import TokenList from '@/components/public/TokenList';
import { EmptyState, Field, LoadingBlock, PageHeader } from '@/components/shared/ui';
import { ADMIN_ROLES, TOKEN_TYPE_LABELS, type MeterLookup, type TokenType, type VendMode, type VendResult } from '@/types/api';

const TOKEN_OPTIONS: { value: TokenType; label: string; help: string }[] = [
  { value: 'CREDIT', label: 'Issue credit', help: 'Vend by unit or by value and record the payment details.' },
  { value: 'CLEAR_TAMPER', label: 'Clear tamper', help: 'Generate a control token that clears the meter’s tamper state.' },
  { value: 'CLEAR_CREDIT', label: 'Clear credit', help: 'Generate a control token that clears the credit stored on the meter.' },
  { value: 'SET_MAX_OVERDRAFT', label: 'Set max overdraft', help: 'Generate a control token that sets the meter’s overdraft limit.' },
];

/** Labelled read-only value in the meter details panel. */
function Info({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card card-pad col" style={{ gap: 6, background: 'var(--surface-2, var(--bg))', boxShadow: 'none' }}>
      <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
      <span className="flex items-start gap-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>{icon}{value}</span>
    </div>
  );
}

function MeterDetails({ meter }: { meter: MeterLookup }) {
  const loc = meter.location;
  const price = toNum(meter.pricePerUnit);
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title flex items-center gap-2"><Gauge size={16} /> Meter details</span>
        <span className={statusPill(meter.status)}>{meter.status}</span>
      </div>
      <div className="card-pad grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Info label="Meter number" value={<span className="mono">{meter.meterNumber}</span>} />
        <Info label="Meter type" value={humanize(meter.type)} />
        <Info label="Vendor" value={meter.vendor?.name ?? 'Not assigned'} icon={<Building2 size={14} />} />
        <Info label="Landlord" value={meter.landlord?.name ?? 'Not assigned'} icon={<Home size={14} />} />
        <Info
          label="Customer"
          value={meter.customer ? <>{meter.customer.name}<br /><span style={{ color: 'var(--muted)', fontWeight: 500 }}>{meter.customer.phone}</span></> : 'No customer linked'}
          icon={<UserIcon size={14} />}
        />
        <Info label="Price per unit" value={price > 0 ? fmtKes(meter.pricePerUnit) : <span style={{ color: 'var(--amber)' }}>Not set</span>} />
        <Info label="Property / unit" value={[loc.property, loc.unit].filter(Boolean).join(' / ') || 'Not linked'} icon={<Home size={14} />} />
        <Info label="Location" value={loc.address || 'Not available'} icon={<MapPin size={14} />} />
      </div>
    </div>
  );
}

/** The last few tokens issued for the selected meter - handy for re-reading one to a customer. */
function RecentForMeter({ meterId }: { meterId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', 'meter', meterId],
    queryFn: () => listTransactions({ meterId, page: 1, limit: 5 }),
  });
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title flex items-center gap-2"><History size={16} /> Recent tokens for this meter</span>
        <Link className="btn btn-ghost btn-sm" to="/transactions">All transactions <ArrowRight size={14} /></Link>
      </div>
      {isLoading ? (
        <LoadingBlock height={120} />
      ) : !data?.data.length ? (
        <EmptyState title="No tokens issued yet" />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{['When', 'Type', 'Amount', 'Token', 'Status'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(t.createdAt)}</td>
                  <td>{TOKEN_TYPE_LABELS[t.tokenType]}</td>
                  <td>{t.amount ? fmtKes(t.amount) : '-'}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{t.tokens[0] ? fmtToken(t.tokens[0], '-') : '-'}</td>
                  <td><span className={statusPill(t.status)}>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TokenActionForm({ meter, onDone }: { meter: MeterLookup; onDone: (r: VendResult) => void }) {
  const queryClient = useQueryClient();
  const [tokenType, setTokenType] = useState<TokenType>('CREDIT');
  const [vendMode, setVendMode] = useState<VendMode>('VALUE');
  const [amount, setAmount] = useState('');
  const [controlValue, setControlValue] = useState('');
  const [reference, setReference] = useState('');
  const [transactionTime, setTransactionTime] = useState('');
  const [sendSms, setSendSms] = useState(true);
  const [phone, setPhone] = useState(meter.customer?.phone ?? '');
  const price = toNum(meter.pricePerUnit);
  const isCredit = tokenType === 'CREDIT';
  const option = TOKEN_OPTIONS.find((o) => o.value === tokenType)!;

  const mutation = useMutation({
    mutationFn: generateToken,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      notify('success', 'Token generated', result.smsSent ? 'Token generated and SMS sent.' : undefined);
      onDone(result);
    },
    onError: (err) => notify('error', 'Token generation failed', errorMessage(err, 'Failed to generate token')),
  });

  const preview = (() => {
    const n = Number(amount);
    if (!isCredit || !(n > 0)) return null;
    if (vendMode === 'UNIT') return price > 0 ? `${n} units ≈ ${fmtKes(n * price)}` : 'No price per unit is set - vend by value instead.';
    return price > 0 ? `${fmtKes(n)} ≈ ${(n / price).toFixed(2)} units` : null;
  })();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isCredit && !(Number(amount) > 0)) return notify('warning', 'Amount required', vendMode === 'UNIT' ? 'Enter units to vend.' : 'Enter the amount in KES.');
    if (sendSms && phone.trim().length < 9) return notify('warning', 'Phone required', 'Enter the phone number to SMS, or untick Send SMS.');
    mutation.mutate({
      meterId: meter.id,
      tokenType,
      vendMode: isCredit ? vendMode : undefined,
      amount: isCredit ? Number(amount) : undefined,
      controlValue: tokenType === 'SET_MAX_OVERDRAFT' && controlValue !== '' ? Number(controlValue) : undefined,
      externalTransactionId: isCredit ? reference.trim() || undefined : undefined,
      transactionTime: isCredit ? nairobiInputToISO(transactionTime) : undefined,
      sendSms,
      phone: sendSms ? phone.trim() : undefined,
    });
  };

  return (
    <form className="card" onSubmit={onSubmit}>
      <div className="card-head"><span className="card-title flex items-center gap-2"><ShieldAlert size={16} /> Token action</span></div>
      <div className="card-pad col" style={{ gap: 14 }}>
        <Field label="Token option" hint={option.help}>
          <select className="eoc-select" value={tokenType} onChange={(e) => { setTokenType(e.target.value as TokenType); setAmount(''); setControlValue(''); }}>
            {TOKEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        {isCredit && (
          <>
            <Field label="Issue credit by">
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                <button type="button" className={vendMode === 'UNIT' ? 'on' : ''} disabled={price <= 0} title={price <= 0 ? 'Set a price per unit first' : undefined} onClick={() => setVendMode('UNIT')}>Vend by unit</button>
                <button type="button" className={vendMode === 'VALUE' ? 'on' : ''} onClick={() => setVendMode('VALUE')}>Vend by value</button>
              </div>
            </Field>
            <Field label={vendMode === 'UNIT' ? 'Units (kWh / m³)' : 'Amount (KES)'} hint={preview ?? undefined}>
              <input className="input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder={vendMode === 'UNIT' ? 'Enter units' : 'Enter amount in KES'} />
            </Field>
            <Field label="Transaction ID (optional)" hint="e.g. an M-Pesa code or cash receipt number">
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Transaction time (optional)" hint="When the customer paid, Nairobi time">
              <input className="input" type="datetime-local" value={transactionTime} onChange={(e) => setTransactionTime(e.target.value)} />
            </Field>
          </>
        )}

        {tokenType === 'SET_MAX_OVERDRAFT' && (
          <Field label="Max overdraft value" hint="Leave blank to use the server default.">
            <input className="input" inputMode="numeric" value={controlValue} onChange={(e) => setControlValue(e.target.value.replace(/\D/g, ''))} placeholder="Enter overdraft value" />
          </Field>
        )}

        <div className="card card-pad col" style={{ gap: 10, boxShadow: 'none' }}>
          <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} /> Send SMS
          </label>
          <Field label="SMS phone number">
            <input className="input" inputMode="tel" disabled={!sendSms} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="2547XXXXXXXX" />
          </Field>
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? <><AppLoader size={16} /> Contacting token server…</> : <><Zap size={16} /> Generate and display token</>}
        </button>
      </div>
    </form>
  );
}

function GeneratedTokens({ result, onReset }: { result: VendResult; onReset: () => void }) {
  const copyAll = async () => {
    const ok = await copyText(result.tokens.map((t) => fmtToken(t, '-')).join('\n'));
    notify(ok ? 'success' : 'error', ok ? 'Copied' : 'Copy failed', ok ? 'Generated token(s) copied to clipboard.' : undefined);
  };
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title flex items-center gap-2"><CheckCircle2 size={16} style={{ color: 'var(--color-status-success)' }} /> Generated token</span>
        <button className="btn btn-ghost btn-sm" onClick={copyAll}><Copy size={14} /> Copy all</button>
      </div>
      <div className="card-pad col" style={{ gap: 12 }}>
        <TokenList tokens={result.tokens} />
        <p className="text-sm" style={{ color: 'var(--ink)' }}>{result.transaction.description}</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {result.transaction.sendSms ? (result.smsSent ? `SMS delivered to ${result.transaction.phone}.` : 'SMS could not be sent - share the token manually.') : 'No SMS was sent.'}
        </p>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onReset}>Issue another token</button>
      </div>
    </div>
  );
}

function TokensPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [params, setParams] = useSearchParams();
  // `?meter=` (legacy deep link) and `?q=` (top-bar search) both pre-fill the lookup.
  const initial = params.get('meter') ?? params.get('q') ?? '';
  const [query, setQuery] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<VendResult | null>(null);

  useEffect(() => {
    const q = params.get('meter') ?? params.get('q') ?? '';
    setQuery(q);
    setSubmitted(q);
  }, [params]);

  const { data: meters, isFetching, error } = useQuery({
    queryKey: ['meter-lookup', submitted],
    queryFn: () => meterLookup(submitted),
    enabled: submitted.length >= 2,
    retry: false,
  });

  // Like the legacy page, the first match is selected automatically.
  useEffect(() => {
    setSelectedId(meters?.[0]?.id ?? null);
    setResult(null);
  }, [meters]);

  const selected = meters?.find((m) => m.id === selectedId) ?? null;
  const portal = role && ADMIN_ROLES.includes(role) ? 'Administrator portal' : role === 'VENDOR' ? 'Vendor portal' : 'Landlord portal';

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setParams({ q });
  };

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow={portal}
        title="Token management"
        subtitle="Search a meter, review its owner and customer, then issue credit or control tokens. Every transaction is recorded against the meter owner's account."
      />

      <div className="tokens-grid">
        <div className="col" style={{ gap: 20, minWidth: 0 }}>
          <div className="card">
            <div className="card-head"><span className="card-title flex items-center gap-2"><Search size={16} /> Meter search</span></div>
            <div className="card-pad col" style={{ gap: 12 }}>
              <form className="flex gap-2 flex-wrap" onSubmit={onSearch}>
                <input className="input" style={{ flex: 1, minWidth: 220 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Meter number, customer phone or customer name" autoFocus />
                <button className="btn btn-primary" type="submit" disabled={isFetching || query.trim().length < 2}>
                  {isFetching ? <AppLoader size={16} /> : <><Search size={15} /> Search</>}
                </button>
              </form>

              {submitted.length >= 2 && !isFetching && error && (
                <EmptyState title="No matching meter found" hint={errorMessage(error, 'Try the full meter number.')} />
              )}

              {meters && meters.length > 0 && (
                <div className="col" style={{ gap: 8 }}>
                  {meters.map((m) => {
                    const on = m.id === selectedId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { setSelectedId(m.id); setResult(null); }}
                        className="card card-pad flex items-center justify-between gap-3"
                        style={{ textAlign: 'left', borderColor: on ? 'var(--green)' : undefined, boxShadow: on ? '0 0 0 2px var(--ring)' : 'none' }}
                      >
                        <span className="col" style={{ gap: 2 }}>
                          <b className="mono" style={{ color: 'var(--ink)' }}>{m.meterNumber}</b>
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>{m.customer?.name ?? 'No customer linked'} · {humanize(m.type)}</span>
                        </span>
                        <span className={statusPill(m.status)}>{m.status}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {selected && <MeterDetails meter={selected} />}
          {selected && <RecentForMeter meterId={selected.id} />}
        </div>

        <div className="col" style={{ gap: 20, minWidth: 0 }}>
          {selected ? (
            result ? (
              <GeneratedTokens result={result} onReset={() => setResult(null)} />
            ) : (
              <TokenActionForm key={selected.id} meter={selected} onDone={setResult} />
            )
          ) : (
            <div className="card">
              <EmptyState icon={<Zap size={28} />} title="Select a meter" hint="Search for a meter to issue a credit or control token." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TokensPage;
