import { useEffect, useId, useState, type ReactNode } from 'react';
import { Check, CircleAlert, CircleCheck, CircleDashed, Copy, Eye, EyeOff, KeyRound, RotateCcw, Save, type LucideIcon } from 'lucide-react';
import AppLoader from '@/components/shared/AppLoader';
import { copyText } from '@/lib/format';

/* Building blocks for the settings forms: fields, secrets, segmented choices,
   switches, a readiness checklist, the sticky save bar and the test console. */

export function SectionHead({ Icon, title, description, aside }: { Icon: LucideIcon; title: string; description: ReactNode; aside?: ReactNode }) {
  return (
    <header className="st-head">
      <span className="st-head-ico"><Icon size={20} /></span>
      <div className="st-head-text">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {aside && <div className="st-head-aside">{aside}</div>}
    </header>
  );
}

export function Fieldset({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="st-fieldset">
      <legend>{title}</legend>
      {hint && <p className="st-fieldset-hint">{hint}</p>}
      <div className="st-grid">{children}</div>
    </fieldset>
  );
}

/** Label + control + hint/error, wired with ids for accessibility. */
export function FormField({ label, required, hint, error, wide, children }: {
  label: string; required?: boolean; hint?: ReactNode; error?: string | null; wide?: boolean;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = `${id}-desc`;
  return (
    <div className={`st-field${wide ? ' wide' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}{required && <b aria-hidden="true"> *</b>}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      <span id={describedBy} className={error ? 'st-error' : 'st-hint'}>
        {error ? <><CircleAlert size={12} /> {error}</> : hint}
      </span>
    </div>
  );
}

/**
 * A secret that may already be stored. Saved secrets are never sent to the
 * browser, so the field shows a "Saved" state until the admin chooses to
 * replace it; an empty value means "keep what's saved".
 */
export function SecretField({ label, isSet, value, onChange, required, hint, error }: {
  label: string; isSet: boolean; value: string; onChange: (v: string) => void; required?: boolean; hint?: ReactNode; error?: string | null;
}) {
  const [replacing, setReplacing] = useState(!isSet);
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!value) setReplacing(!isSet); }, [isSet, value]);

  return (
    <FormField label={label} required={required && !isSet} hint={hint ?? (isSet ? 'Stored encrypted. Replace only if it changed.' : undefined)} error={error}>
      {(a11y) => replacing ? (
        <span className="st-secret">
          <KeyRound size={15} className="st-secret-ico" aria-hidden="true" />
          <input
            {...a11y}
            className="input mono"
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder={isSet ? 'Enter the new value' : ''}
            onChange={(e) => onChange(e.target.value.trim())}
            autoFocus={isSet}
          />
          <button type="button" className="st-icon-btn" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide value' : 'Show value'}>
            {shown ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          {isSet && (
            <button type="button" className="st-link-btn" onClick={() => { onChange(''); setReplacing(false); }}>Keep saved</button>
          )}
        </span>
      ) : (
        <span className="st-secret saved" id={a11y.id}>
          <Check size={15} className="st-secret-ok" aria-hidden="true" />
          <span className="st-secret-dots" aria-label="Saved value hidden">••••••••••••</span>
          <button type="button" className="st-link-btn" onClick={() => setReplacing(true)}>Replace</button>
        </span>
      )}
    </FormField>
  );
}

/** Pick-one control rendered as cards (or compact pills). */
export function Segmented<T extends string>({ value, onChange, options, compact, label }: {
  value: T; onChange: (v: T) => void; label: string; compact?: boolean;
  options: { value: T; title: string; description?: string; Icon?: LucideIcon; tone?: 'warn' }[];
}) {
  return (
    <div className={`st-seg${compact ? ' compact' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`st-seg-opt${on ? ' on' : ''}${o.tone === 'warn' ? ' warn' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.Icon && <span className="st-seg-ico"><o.Icon size={16} /></span>}
            <span className="st-seg-text">
              <b>{o.title}</b>
              {o.description && <small>{o.description}</small>}
            </span>
            <span className="st-seg-radio" aria-hidden="true">{on && <Check size={11} strokeWidth={3.5} />}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, tone }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; tone?: 'warn';
}) {
  return (
    <label className={`st-switch-row${checked ? ' on' : ''}${tone === 'warn' ? ' warn' : ''}`}>
      <span className="st-switch-text">
        <b>{label}</b>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="st-switch" aria-hidden="true"><i /></span>
    </label>
  );
}

export interface CheckItem { label: string; ok: boolean; hint?: string }

/** "Ready to go?" list - turns every requirement into a visible tick. */
export function Readiness({ title, items }: { title: string; items: CheckItem[] }) {
  const done = items.filter((i) => i.ok).length;
  const ready = done === items.length;
  return (
    <aside className={`st-ready${ready ? ' ok' : ''}`} aria-live="polite">
      <div className="st-ready-head">
        <b>{title}</b>
        <span>{done}/{items.length}</span>
      </div>
      <span className="st-ready-bar"><i style={{ width: `${(done / items.length) * 100}%` }} /></span>
      <ul>
        {items.map((i) => (
          <li key={i.label} className={i.ok ? 'ok' : ''}>
            {i.ok ? <CircleCheck size={15} /> : <CircleDashed size={15} />}
            <span>{i.label}{!i.ok && i.hint && <small>{i.hint}</small>}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Sticky bar that appears while a form has unsaved edits. Ctrl/Cmd+S saves. */
export function SaveBar({ count, saving, onSave, onDiscard, disabled, label = 'Save changes' }: {
  count: number; saving: boolean; onSave: () => void; onDiscard: () => void; disabled?: boolean; label?: string;
}) {
  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saving && !disabled) onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, saving, disabled, onSave]);

  return (
    <div className={`st-savebar${count ? ' show' : ''}`} role="region" aria-label="Unsaved changes" aria-hidden={!count}>
      <span className="st-savebar-text"><i aria-hidden="true" /> {count} unsaved change{count === 1 ? '' : 's'} <kbd>Ctrl S</kbd></span>
      <span className="st-savebar-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard} disabled={saving} tabIndex={count ? 0 : -1}><RotateCcw size={14} /> Discard</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving || disabled} tabIndex={count ? 0 : -1}>
          {saving ? <AppLoader size={14} /> : <><Save size={14} /> {label}</>}
        </button>
      </span>
    </div>
  );
}

export interface TestResult { ok: boolean; message: string; at: Date; target: string }

/** Inline test runner with a short history, instead of fire-and-forget toasts. */
export function TestConsole({ title, description, children, results, running, onRun, runLabel, RunIcon }: {
  title: string; description: ReactNode; children: ReactNode; results: TestResult[]; running: boolean;
  onRun: () => void; runLabel: string; RunIcon: LucideIcon;
}) {
  return (
    <section className="st-test">
      <div className="st-test-head">
        <b>{title}</b>
        <p>{description}</p>
      </div>
      <form className="st-test-form" onSubmit={(e) => { e.preventDefault(); onRun(); }}>
        {children}
        <button className="btn btn-soft" type="submit" disabled={running}>
          {running ? <AppLoader size={15} /> : <><RunIcon size={15} /> {runLabel}</>}
        </button>
      </form>
      {results.length > 0 && (
        <ol className="st-test-log" aria-live="polite">
          {results.map((r) => (
            <li key={r.at.getTime()} className={r.ok ? 'ok' : 'fail'}>
              {r.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
              <span className="st-test-msg">{r.message}</span>
              <span className="st-test-meta">{r.target} · {r.at.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="st-link-btn"
      onClick={async () => { if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
    >
      {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> {label}</>}
    </button>
  );
}

/** Kenyan mobile check shared by the test consoles. */
export const isKenyanMobile = (v: string) => /^(?:\+?254|0)?[71]\d{8}$/.test(v.replace(/\s+/g, ''));

export const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
