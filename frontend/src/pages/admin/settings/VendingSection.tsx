import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, TriangleAlert } from 'lucide-react';
import { listVendingSettings, updateVendingSettings } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { EmptyState, LoadingBlock } from '@/components/shared/ui';
import type { VendingSetting } from '@/types/api';
import { SaveBar, SectionHead } from './formKit';

/** Plain-language names and sane ranges for the STS key data. */
const PARAMS: Record<string, { code: string; name: string; hint: string; check?: (v: string) => string | null }> = {
  vending_sgc: { code: 'SGC', name: 'Supply Group Code', hint: 'Identifies the utility’s key group. 6 digits.', check: (v) => (v.length !== 6 ? 'SGC is 6 digits' : null) },
  vending_krn: { code: 'KRN', name: 'Key Revision Number', hint: 'Revision of the vending key, 1-9.', check: (v) => (Number(v) < 1 || Number(v) > 9 ? 'KRN is between 1 and 9' : null) },
  vending_ti: { code: 'TI', name: 'Tariff Index', hint: 'Tariff the meter is on, 0-99.', check: (v) => (Number(v) > 99 ? 'TI is between 0 and 99' : null) },
  vending_ea: { code: 'EA', name: 'Encryption Algorithm', hint: '7 = STA (standard), 11 = MISTY1.', check: (v) => (!['7', '11'].includes(v) ? 'Usually 7 (STA) or 11 (MISTY1)' : null) },
  vending_tct: { code: 'TCT', name: 'Token Carrier Type', hint: '1 for standard numeric (keypad) tokens.' },
  vending_ken: { code: 'KEN', name: 'Key Expiry Number', hint: '255 means the key never expires.', check: (v) => (Number(v) > 255 ? 'KEN is between 0 and 255' : null) },
};

const same = (a: VendingSetting, b: VendingSetting) => (a.value ?? '') === (b.value ?? '') && a.isActive === b.isActive;

export default function VendingSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const { data: settings = [], isLoading } = useQuery({ queryKey: ['vending-settings'], queryFn: listVendingSettings });
  const [rows, setRows] = useState<VendingSetting[]>([]);
  useEffect(() => setRows(settings), [settings]);

  const original = useMemo(() => Object.fromEntries(settings.map((s) => [s.key, s])), [settings]);
  const changed = rows.filter((r) => original[r.key] && !same(r, original[r.key]));
  useEffect(() => onDirtyChange(changed.length > 0), [changed.length, onDirtyChange]);

  const errorOf = (r: VendingSetting) => {
    const v = r.value ?? '';
    if (!r.isActive && !v) return null;
    if (!v) return 'Enter a value to activate this override';
    return PARAMS[r.key]?.check?.(v) ?? null;
  };
  const hasErrors = rows.some((r) => r.isActive && errorOf(r));
  const activeCount = rows.filter((r) => r.isActive).length;

  const update = (key: string, patch: Partial<VendingSetting>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => updateVendingSettings(rows.map((r) => ({ key: r.key, value: r.value, isActive: r.isActive }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vending-settings'] });
      notify('success', 'Vending settings saved');
    },
    onError: (err) => notify('error', 'Could not save', errorMessage(err)),
  });

  const onSave = async () => {
    const newlyActive = changed.filter((r) => r.isActive && (!original[r.key]?.isActive || r.value !== original[r.key]?.value));
    if (newlyActive.length) {
      const list = newlyActive.map((r) => `${PARAMS[r.key]?.code ?? r.key} = ${r.value}`).join(', ');
      const ok = await confirmDialog({
        title: 'Override every meter?',
        text: `${list} will be used for ALL meters instead of each meter's own key data. Wrong values make tokens unusable.`,
        confirmLabel: 'Apply override',
        danger: true,
      });
      if (!ok) return;
    }
    save.mutate();
  };

  if (isLoading) return <LoadingBlock height={420} />;
  if (rows.length === 0) return <div className="card"><EmptyState title="No vending settings yet" hint="Run the database seed to create the STS keys." /></div>;

  return (
    <div className="st-section">
      <div className="card st-card">
        <SectionHead
          Icon={Cpu}
          title="STS vending"
          description="Key data sent to Prism with every token. Normally each meter uses its own values; switch an override on only to force one value onto every meter."
          aside={<span className={`pill ${activeCount ? 'pill-amber' : 'pill-green'}`}><span className="dot" />{activeCount ? `${activeCount} override${activeCount === 1 ? '' : 's'} active` : 'Per-meter values'}</span>}
        />

        <div className="st-body">
          <div className="st-callout">
            <TriangleAlert size={18} />
            <p><b>Change with care.</b> These values must match what is programmed into the meters. A wrong SGC, KRN or EA produces tokens the meter rejects.</p>
          </div>

          <div className="st-params">
            {rows.map((r) => {
              const meta = PARAMS[r.key] ?? { code: r.key.replace('vending_', '').toUpperCase(), name: r.description ?? r.key, hint: '' };
              const err = errorOf(r);
              const isChanged = original[r.key] && !same(r, original[r.key]);
              return (
                <div key={r.key} className={`st-param${r.isActive ? ' active' : ''}${isChanged ? ' changed' : ''}`}>
                  <div className="st-param-top">
                    <span className="st-param-code">{meta.code}</span>
                    <label className="st-mini-switch" title={r.isActive ? 'Override on - applies to every meter' : 'Override off - meters use their own value'}>
                      <input type="checkbox" role="switch" aria-label={`Override ${meta.name} for every meter`} checked={r.isActive} onChange={(e) => update(r.key, { isActive: e.target.checked })} />
                      <span aria-hidden="true"><i /></span>
                    </label>
                  </div>
                  <b className="st-param-name">{meta.name}</b>
                  <input
                    className="input mono st-param-input"
                    inputMode="numeric"
                    aria-label={`${meta.name} value`}
                    aria-invalid={!!(r.isActive && err)}
                    value={r.value ?? ''}
                    onChange={(e) => update(r.key, { value: e.target.value.replace(/\D/g, '') })}
                  />
                  <small className={r.isActive && err ? 'st-error' : 'st-hint'}>{r.isActive && err ? err : r.isActive ? 'Overrides every meter' : meta.hint}</small>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <SaveBar count={changed.length} saving={save.isPending} disabled={hasErrors} onSave={onSave} onDiscard={() => setRows(settings)} />
    </div>
  );
}
