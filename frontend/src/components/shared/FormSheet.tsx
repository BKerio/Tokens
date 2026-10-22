import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, CircleAlert, X, type LucideIcon } from 'lucide-react';
import AppLoader from '@/components/shared/AppLoader';

export interface SheetStep {
  id: string;
  title: string;
  Icon: LucideIcon;
  /** Shows a tick on the step and section heading. */
  done?: boolean;
}

interface SheetCtx {
  steps: SheetStep[];
  register: (id: string, el: HTMLElement | null) => void;
}

const Ctx = createContext<SheetCtx>({ steps: [], register: () => {} });

/**
 * The app's standard form dialog (same look as Add property / vendor
 * registration): icon header, optional step tabs with a progress bar, a
 * scrolling body of <SheetSection>s and a footer with a summary and actions.
 * Steps appear when there are two or more; after a submit with errors the
 * body scrolls to the first error.
 */
export function FormSheet({
  icon: Icon, title, subtitle, steps = [], onClose, onSubmit, busy, submitLabel = 'Save', submitIcon = true,
  danger, meta, error, width = 720, children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  steps?: SheetStep[];
  onClose: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  busy?: boolean;
  submitLabel?: ReactNode;
  /** Arrow after the submit label. */
  submitIcon?: boolean;
  danger?: boolean;
  /** Footer text on the left, e.g. a running total. */
  meta?: ReactNode;
  error?: string;
  width?: number;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [active, setActive] = useState(steps[0]?.id ?? '');
  const showSteps = steps.length >= 2;
  const completed = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((completed / steps.length) * 100) : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body || !showSteps) return;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
    let current = steps[0]!.id;
    for (const s of steps) {
      const el = refs.current[s.id];
      if (el && el.offsetTop - body.scrollTop <= 90) current = s.id;
    }
    setActive(atBottom ? steps[steps.length - 1]!.id : current);
  };

  const goTo = (id: string) => {
    const body = bodyRef.current;
    const el = refs.current[id];
    if (body && el) body.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
    setActive(id);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    onSubmit(e);
    // Validation errors render on the next frames - bring the first into view.
    window.setTimeout(() => {
      const body = bodyRef.current;
      const err = body?.querySelector('.field-error, .vf-alert');
      if (body && err) {
        const top = (err as HTMLElement).getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 80;
        body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }, 60);
  };

  return (
    <div className="vf-overlay" onClick={onClose}>
      <form className="vf-modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
        <header className="vf-head">
          <div className="vf-head-row">
            <span className={`vf-head-ico${danger ? ' danger' : ''}`}><Icon size={22} /></span>
            <div className="vf-head-text">
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button type="button" className="vf-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>

          {showSteps && (
            <>
              <nav className="vf-steps" aria-label="Form sections">
                {steps.map((s, i) => (
                  <button key={s.id} type="button" className={`vf-step${active === s.id ? ' on' : ''}${s.done ? ' done' : ''}`} onClick={() => goTo(s.id)}>
                    <span className="vf-step-num">{s.done && active !== s.id ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                    {s.title}
                  </button>
                ))}
              </nav>
              <div className="vf-progress">
                <span className="vf-progress-track"><i style={{ width: `${pct}%` }} /></span>
                <b>{completed} of {steps.length} complete</b>
              </div>
            </>
          )}
        </header>

        <div className="vf-body scroll-thin" ref={bodyRef} onScroll={onScroll}>
          {error && <div className="vf-alert" role="alert"><CircleAlert size={16} /> {error}</div>}
          <Ctx.Provider value={{ steps, register: (id, el) => { refs.current[id] = el; } }}>{children}</Ctx.Provider>
        </div>

        <footer className="vf-foot">
          <span className="vf-foot-meta">{meta}</span>
          <span className="vf-foot-actions">
            <button type="button" className="vf-btn vf-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className={`vf-btn vf-btn-primary${danger ? ' danger' : ''}`} disabled={busy}>
              {busy ? <AppLoader size={16} /> : <>{submitLabel}{submitIcon && <ArrowRight size={16} />}</>}
            </button>
          </span>
        </footer>
      </form>
    </div>
  );
}

/** One titled section of a FormSheet. Uses its step's title/icon when `id` matches a step. */
export function SheetSection({ id, title, Icon, aside, children }: { id: string; title?: string; Icon?: LucideIcon; aside?: ReactNode; children: ReactNode }) {
  const { steps, register } = useContext(Ctx);
  const step = steps.find((s) => s.id === id);
  const SectionIcon = Icon ?? step?.Icon;
  const heading = title ?? step?.title;
  return (
    <section className="vf-section" ref={(el) => register(id, el)}>
      {heading && (
        <h3 className="vf-section-title">
          {SectionIcon && <span className="vf-section-ico"><SectionIcon size={15} /></span>}
          {heading}
          {step?.done && <Check size={15} className="vf-section-done" />}
          {aside && <span className="vf-section-aside">{aside}</span>}
        </h3>
      )}
      {children}
    </section>
  );
}

/** Label + control + error/hint in the FormSheet style. */
export function SheetField({ label, required, hint, error, aside, span, children }: {
  label?: string; required?: boolean; hint?: ReactNode; error?: string; aside?: ReactNode; span?: boolean; children: ReactNode;
}) {
  return (
    <label className={`vf-field${span ? ' vf-span' : ''}`} onClick={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
      {label && (
        <span className="vf-label-row">
          <span className="vf-label">{label}{required && <b> *</b>}</span>
          {aside && <small>{aside}</small>}
        </span>
      )}
      {children}
      {hint && !error && <span className="vf-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

/** Two columns on wide screens, one on phones. */
export function SheetGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`vf-grid${cols === 3 ? ' vf-grid-3' : ''}`}>{children}</div>;
}

/** Pill choices (single select). */
export function ChoiceChips<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; tone?: 'ok' | 'warn' }[]; label?: string;
}) {
  return (
    <div className="vf-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`vf-chip${o.tone ? ` ${o.tone}` : ''}${value === o.value ? ' on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          <i />{o.label}
        </button>
      ))}
    </div>
  );
}

/** Icon tiles with a one-line hint (single select). */
export function ChoiceTiles<T extends string>({ value, onChange, options, label, cols = 3 }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string; Icon: LucideIcon }[]; label?: string; cols?: 2 | 3 | 4;
}) {
  return (
    <div className={`pf-types cols-${cols}`} role="radiogroup" aria-label={label}>
      {options.map(({ value: v, label: l, hint, Icon }) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={`pf-type${value === v ? ' on' : ''}`} onClick={() => onChange(v)}>
          <span className="pf-type-ico"><Icon size={18} /></span>
          <span className="pf-type-text"><b>{l}</b>{hint && <small>{hint}</small>}</span>
        </button>
      ))}
    </div>
  );
}

/** Large KES amount entry with optional quick-fill chips. */
export function AmountInput({ value, onChange, presets = [], autoFocus, label = 'Amount', currency = 'KES' }: {
  value: string; onChange: (v: string) => void; presets?: { label: string; amount: number }[]; autoFocus?: boolean; label?: string; currency?: string;
}) {
  return (
    <div className="pf-amount-wrap">
      <span className="pf-amount">
        <span className="pf-amount-cur">{currency}</span>
        <input
          className="mono"
          inputMode="decimal"
          placeholder="0.00"
          aria-label={label}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
        />
      </span>
      {presets.length > 0 && (
        <div className="vf-chips">
          {presets.map((p) => (
            <button key={p.label} type="button" className={`vf-chip${Number(value) === p.amount ? ' on' : ''}`} onClick={() => onChange(String(p.amount))}>
              <i />{p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Highlighted summary line used at the end of a form ("Tenant will owe KES …"). */
export function SheetNote({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger'; children: ReactNode }) {
  return <p className={`vf-note${tone !== 'info' ? ` ${tone}` : ''}`}>{children}</p>;
}
