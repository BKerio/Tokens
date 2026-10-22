import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, FlaskConical, Hash, Home, Network, Radio, Search, Store, Zap } from 'lucide-react';
import { getEntityMpesaConfig, listPaymentEntities, saveEntityMpesaConfig, testMpesa, type MpesaConfigInput } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { EmptyState, LoadingBlock } from '@/components/shared/ui';
import type { MpesaConfig, MpesaEnv, MpesaTransactionType, PaymentEntity } from '@/types/api';
import {
  FormField, Fieldset, Readiness, SaveBar, SecretField, SectionHead, Segmented, TestConsole, isHttpUrl, isKenyanMobile, type TestResult,
} from './formKit';

type Filter = 'all' | 'dedicated' | 'global';

interface EntityForm {
  consumerKey: string; consumerSecret: string; passkey: string;
  shortcode: string; tillNo: string; env: MpesaEnv; transactionType: MpesaTransactionType; callbackUrl: string;
}

const toForm = (cfg: MpesaConfig | null): EntityForm => ({
  consumerKey: '', consumerSecret: '', passkey: '',
  shortcode: cfg?.shortcode ?? '', tillNo: cfg?.tillNo ?? '',
  env: cfg?.env ?? 'SANDBOX', transactionType: cfg?.transactionType ?? 'CUSTOMER_BUYGOODS_ONLINE', callbackUrl: cfg?.callbackUrl ?? '',
});

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';

function EntityMpesaForm({ entity, onDirtyChange }: { entity: PaymentEntity; onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['entity-mpesa', entity.type, entity.id], queryFn: () => getEntityMpesaConfig(entity.type, entity.id) });
  const cfg = data?.mpesaConfig ?? null;
  const baseline = useMemo(() => toForm(cfg), [cfg]);
  const [form, setForm] = useState<EntityForm>(baseline);
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<TestResult[]>([]);

  useEffect(() => setForm(baseline), [baseline]);
  const set = <K extends keyof EntityForm>(k: K, v: EntityForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const changed = (Object.keys(form) as (keyof EntityForm)[]).filter((k) => form[k] !== baseline[k]);
  useEffect(() => onDirtyChange(changed.length > 0), [changed.length, onDirtyChange]);

  const buyGoods = form.transactionType === 'CUSTOMER_BUYGOODS_ONLINE';
  const errors = {
    shortcode: form.shortcode && !/^\d+$/.test(form.shortcode) ? 'Numbers only' : null,
    tillNo: form.tillNo && !/^\d+$/.test(form.tillNo) ? 'Numbers only' : null,
    callbackUrl: form.callbackUrl && !isHttpUrl(form.callbackUrl) ? 'Enter a full URL' : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () => {
      // Blank secrets mean "keep what's stored"; send only filled values.
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')) as MpesaConfigInput;
      return saveEntityMpesaConfig(entity.type, entity.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entity-mpesa', entity.type, entity.id] });
      queryClient.invalidateQueries({ queryKey: ['payment-entities'] });
      notify('success', `M-Pesa saved for ${entity.name}`);
    },
    onError: (err) => notify('error', 'Could not save', errorMessage(err)),
  });

  const push = useCallback((r: TestResult) => setResults((prev) => [r, ...prev].slice(0, 4)), []);
  const test = useMutation({
    mutationFn: () => testMpesa({ phone, amount: 1, [entity.type === 'vendor' ? 'vendorId' : 'landlordId']: entity.id }),
    onSuccess: (msg) => push({ ok: true, message: msg || 'Prompt sent - check the phone', at: new Date(), target: `${phone} · KES 1` }),
    onError: (err) => push({ ok: false, message: errorMessage(err), at: new Date(), target: `${phone} · KES 1` }),
  });

  if (isLoading) return <LoadingBlock height={420} />;

  const keySet = (flag?: boolean, v?: string) => !!flag || !!v;
  const readiness = [
    { label: 'Consumer key & secret', ok: keySet(cfg?.consumerKeySet, form.consumerKey) && keySet(cfg?.consumerSecretSet, form.consumerSecret) },
    { label: 'Passkey', ok: keySet(cfg?.passkeySet, form.passkey) },
    { label: 'Business shortcode', ok: !!form.shortcode && !errors.shortcode },
    ...(buyGoods ? [{ label: 'Till number', ok: !!form.tillNo && !errors.tillNo, hint: 'Required for Buy Goods' }] : []),
  ];

  return (
    <>
      <div className="st-body">
        <p className="st-lead">
          STK pushes for meters owned by <b>{entity.name}</b> are charged to this Daraja account, so customers pay them directly.
          {!cfg && ' Until it is saved, the global M-Pesa settings are used.'}
        </p>
        <div className="st-split">
          <div className="st-split-main">
            <Fieldset title="Environment & payment type">
              <div className="st-wide">
                <Segmented<MpesaEnv>
                  compact
                  label="Environment"
                  value={form.env}
                  onChange={(v) => set('env', v)}
                  options={[
                    { value: 'SANDBOX', title: 'Sandbox', Icon: FlaskConical },
                    { value: 'LIVE', title: 'Live', Icon: Radio, tone: 'warn' },
                  ]}
                />
              </div>
              <div className="st-wide">
                <Segmented<MpesaTransactionType>
                  compact
                  label="Transaction type"
                  value={form.transactionType}
                  onChange={(v) => set('transactionType', v)}
                  options={[
                    { value: 'CUSTOMER_BUYGOODS_ONLINE', title: 'Buy Goods (till)', Icon: Store },
                    { value: 'CUSTOMER_PAYBILL_ONLINE', title: 'Paybill', Icon: Hash },
                  ]}
                />
              </div>
              <FormField label="Business shortcode" required error={errors.shortcode}>
                {(a) => <input {...a} className="input mono" inputMode="numeric" value={form.shortcode} onChange={(e) => set('shortcode', e.target.value.trim())} />}
              </FormField>
              {buyGoods && (
                <FormField label="Till number" required error={errors.tillNo}>
                  {(a) => <input {...a} className="input mono" inputMode="numeric" value={form.tillNo} onChange={(e) => set('tillNo', e.target.value.trim())} />}
                </FormField>
              )}
            </Fieldset>

            <Fieldset title="Daraja credentials">
              <SecretField key={`ck-${entity.id}`} label="Consumer key" isSet={!!cfg?.consumerKeySet} value={form.consumerKey} onChange={(v) => set('consumerKey', v)} required />
              <SecretField key={`cs-${entity.id}`} label="Consumer secret" isSet={!!cfg?.consumerSecretSet} value={form.consumerSecret} onChange={(v) => set('consumerSecret', v)} required />
              <SecretField key={`pk-${entity.id}`} label="Passkey" isSet={!!cfg?.passkeySet} value={form.passkey} onChange={(v) => set('passkey', v)} required />
            </Fieldset>

            <Fieldset title="Callback">
              <FormField label="Callback URL" wide error={errors.callbackUrl} hint="Optional - leave blank to use the global callback">
                {(a) => <input {...a} className="input mono" inputMode="url" placeholder="https://" value={form.callbackUrl} onChange={(e) => set('callbackUrl', e.target.value.trim())} />}
              </FormField>
            </Fieldset>
          </div>
          <Readiness title="Ready to take payments" items={readiness} />
        </div>
      </div>

      {cfg && (
        <TestConsole
          title="Test this account"
          description={`Sends a KES 1 STK push using ${entity.name}'s saved credentials.`}
          results={results}
          running={test.isPending}
          runLabel="Send KES 1 prompt"
          RunIcon={Zap}
          onRun={() => { if (isKenyanMobile(phone)) test.mutate(); }}
        >
          <FormField label="Phone" error={phone && !isKenyanMobile(phone) ? 'Enter a Kenyan mobile number' : null}>
            {(a) => <input {...a} className="input" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </FormField>
        </TestConsole>
      )}

      <SaveBar
        count={changed.length}
        saving={save.isPending}
        disabled={hasErrors}
        label={cfg ? 'Save changes' : 'Create configuration'}
        onSave={() => save.mutate()}
        onDiscard={() => setForm(baseline)}
      />
    </>
  );
}

export default function PartnerApisSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['payment-entities'], queryFn: listPaymentEntities });
  const [selected, setSelected] = useState<PaymentEntity | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dirty, setDirty] = useState(false);
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const onFormDirty = useCallback((d: boolean) => { setDirty(d); onDirtyChange(d); }, [onDirtyChange]);

  const all = useMemo(() => [...(data?.vendors ?? []), ...(data?.landlords ?? [])], [data]);
  const counts = { all: all.length, dedicated: all.filter((e) => e.hasMpesaConfig).length, global: all.filter((e) => !e.hasMpesaConfig).length };
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (e) => (filter === 'all' || (filter === 'dedicated') === e.hasMpesaConfig) && (!q || e.name.toLowerCase().includes(q) || e.subtitle.toLowerCase().includes(q)),
  );

  const choose = async (e: PaymentEntity) => {
    if (selected && e.id === selected.id && e.type === selected.type) return;
    if (dirty && !(await confirmDialog({ title: 'Discard unsaved changes?', text: `Your edits to ${selected?.name} haven't been saved.`, confirmLabel: 'Discard', danger: true }))) return;
    onFormDirty(false);
    setSelected(e);
    // When the list is stacked above the form (narrow screens), bring the form into view.
    requestAnimationFrame(() => {
      const list = listRef.current, detail = detailRef.current;
      if (list && detail && detail.offsetTop > list.offsetTop) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (isLoading || !data) return <LoadingBlock height={420} />;

  return (
    <div className="st-section">
      <div className="card st-card">
        <SectionHead
          Icon={Network}
          title="Partner payment APIs"
          description="Give a vendor or landlord their own Daraja account so their customers pay them directly. Everyone else uses the global M-Pesa settings."
          aside={<span className="pill pill-green"><span className="dot" />{counts.dedicated} dedicated</span>}
        />

        <div className="st-master">
          <nav ref={listRef} className="st-master-list" aria-label="Vendors and landlords">
            <div className="st-master-tools">
              <span className="st-search">
                <Search size={15} aria-hidden="true" />
                <input type="search" placeholder="Search partners" aria-label="Search partners" value={query} onChange={(e) => setQuery(e.target.value)} />
              </span>
              <div className="st-chips" role="tablist" aria-label="Filter partners">
                {([['all', 'All'], ['dedicated', 'Own account'], ['global', 'Using global']] as [Filter, string][]).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={filter === key} className={`st-chip${filter === key ? ' on' : ''}`} onClick={() => setFilter(key)}>
                    {label} <span>{counts[key]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="st-master-rows scroll-thin">
              {shown.length === 0 ? (
                <EmptyState title={all.length ? 'No partners match' : 'No vendors or landlords yet'} />
              ) : shown.map((e) => {
                const on = selected?.id === e.id && selected?.type === e.type;
                return (
                  <button key={`${e.type}-${e.id}`} type="button" className={`st-entity${on ? ' on' : ''}`} onClick={() => choose(e)} aria-current={on ? 'true' : undefined}>
                    <span className={`st-entity-av ${e.type}`}>{initials(e.name)}</span>
                    <span className="st-entity-text">
                      <b>{e.name}</b>
                      <small>{e.type === 'vendor' ? <Building2 size={11} /> : <Home size={11} />} {e.subtitle}</small>
                    </span>
                    {e.hasMpesaConfig
                      ? <span className={`pill ${e.mpesaEnv === 'LIVE' ? 'pill-amber' : 'pill-blue'}`}>{e.mpesaEnv === 'LIVE' ? 'Live' : 'Sandbox'}</span>
                      : <span className="pill pill-gray">Global</span>}
                  </button>
                );
              })}
            </div>
          </nav>

          <div ref={detailRef} className="st-master-detail" style={{ scrollMarginTop: 84 }}>
            {selected ? (
              <>
                <div className="st-detail-head">
                  <span className={`st-entity-av lg ${selected.type}`}>{initials(selected.name)}</span>
                  <span>
                    <b>{selected.name}</b>
                    <small>{selected.type === 'vendor' ? 'Vendor' : 'Landlord'} · {selected.subtitle}</small>
                  </span>
                </div>
                <EntityMpesaForm key={`${selected.type}-${selected.id}`} entity={selected} onDirtyChange={onFormDirty} />
              </>
            ) : (
              <EmptyState icon={<Network size={28} />} title="Pick a vendor or landlord" hint="Their Daraja credentials, environment and test tools will appear here." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
