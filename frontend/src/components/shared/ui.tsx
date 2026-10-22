import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox, X } from 'lucide-react';
import type { PaginatedMeta } from '@/types/api';
import AppLoader from '@/components/shared/AppLoader';

/** Eyebrow + title + subtitle, with optional actions on the right. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>{title}</h2>
        {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/** Centered dialog using the card styles. */
export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,20,15,0.45)' }} onClick={onClose}>
      <div className="card w-full scroll-thin" style={{ maxWidth: width, maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <span className="card-title">{title}</span>
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Right-hand slide-over panel. */
export function Drawer({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <div className="drawer" style={width ? { width: `min(${width}px, 96vw)` } : undefined}>
        <div className="card-head">
          <span className="card-title">{title}</span>
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="col scroll-thin" style={{ gap: 12, padding: 16, overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card-pad flex flex-col items-center text-center" style={{ gap: 8, padding: '48px 20px' }}>
      <span style={{ color: 'var(--muted)' }}>{icon ?? <Inbox size={30} />}</span>
      <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>{title}</p>
      {hint && <p className="text-sm" style={{ color: 'var(--muted)' }}>{hint}</p>}
      {action}
    </div>
  );
}

/** Full-area loader shown while a page (or its code) loads. */
export function PageLoader({ minHeight = '60vh' }: { minHeight?: number | string }) {
  return (
    <div className="flex items-center justify-center" style={{ minHeight, color: 'var(--green)' }}>
      <AppLoader size={72} label="Loading" />
    </div>
  );
}

/** Centered loader filling roughly the space the content will take. */
export function LoadingBlock({ height = 200 }: { height?: number }) {
  return (
    <div className="card-pad flex items-center justify-center" style={{ minHeight: height, color: 'var(--green)' }}>
      <AppLoader size={64} label="Loading" />
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta?: PaginatedMeta; onPage: (page: number) => void }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between card-pad" style={{ borderTop: '1px solid var(--border)' }}>
      <span className="text-sm" style={{ color: 'var(--muted)' }}>
        Page {meta.page} of {meta.totalPages} · {meta.total} total
      </span>
      <div className="flex gap-2">
        <button className="btn btn-ghost btn-sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}><ChevronLeft size={14} /> Prev</button>
        <button className="btn btn-ghost btn-sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>Next <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

/** Label + control + error, the standard form row. */
export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

/** Two-column responsive grid for forms. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>{children}</div>;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input className="input" style={{ maxWidth: 320 }} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  );
}
