import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bulkUpdateSystemConfig, listSystemConfig } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import type { SystemConfig } from '@/types/api';

export type ConfigCategory = 'sms' | 'mpesa';

export const configQueryKey = (category: ConfigCategory) => ['system-config', category] as const;

/** Initial form value: masked secrets start empty ("keep what's saved"). */
const initialValue = (c: SystemConfig) => (c.isMasked ? '' : c.value ?? '');

/**
 * One SystemConfig category as an editable form: local values, which keys
 * changed, validation errors, discard, and a save that sends only changes.
 */
export function useConfigForm(category: ConfigCategory, validate?: (values: Record<string, string>) => Record<string, string | null>) {
  const queryClient = useQueryClient();
  const { data: configs = [], isLoading } = useQuery({ queryKey: configQueryKey(category), queryFn: () => listSystemConfig(category) });
  const [values, setValues] = useState<Record<string, string>>({});

  const baseline = useMemo(() => Object.fromEntries(configs.map((c) => [c.key, initialValue(c)])), [configs]);
  useEffect(() => setValues(baseline), [baseline]);

  const byKey = useMemo(() => Object.fromEntries(configs.map((c) => [c.key, c])) as Record<string, SystemConfig | undefined>, [configs]);

  const dirtyKeys = useMemo(
    () => configs.filter((c) => (c.isMasked ? (values[c.key] ?? '') !== '' : (values[c.key] ?? '') !== (c.value ?? ''))).map((c) => c.key),
    [configs, values],
  );

  const errors = useMemo(() => (validate ? validate(values) : {}), [validate, values]);
  const hasErrors = Object.values(errors).some(Boolean);

  const set = useCallback((key: string, value: string) => setValues((v) => ({ ...v, [key]: value })), []);
  const reset = useCallback(() => setValues(baseline), [baseline]);

  const save = useMutation({
    mutationFn: () => bulkUpdateSystemConfig(dirtyKeys.map((key) => ({ key, value: values[key] ?? '' }))),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: configQueryKey(category) });
      notify('success', updated.length ? `Saved ${updated.length} setting${updated.length === 1 ? '' : 's'}` : 'Nothing changed');
    },
    onError: (err) => notify('error', 'Could not save settings', errorMessage(err)),
  });

  /** Current value of a key: the edited value, falling back to what's stored (masked secrets stay ''). */
  const value = (key: string) => values[key] ?? '';
  /** Whether a secret is stored server-side (so leaving it blank keeps it). */
  const isSet = (key: string) => !!byKey[key]?.isMasked || !!byKey[key]?.value;

  return { configs, byKey, isLoading, values, value, set, isSet, dirtyKeys, errors, hasErrors, reset, save };
}
