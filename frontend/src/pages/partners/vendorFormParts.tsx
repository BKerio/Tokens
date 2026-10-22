import type { ReactNode } from 'react';

/** Bank choices shown as cards on the vendor forms (name, initials). */
export const BANKS: [string, string][] = [['NCBA', 'NC'], ['Equity Bank', 'EQ'], ['KCB', 'KC'], ['Co-op Bank', 'CO'], ['Absa', 'AB'], ['Stanbic', 'SB']];

/** Password strength 0-4 for the meter under the field. */
export function strength(pw: string) {
  return [pw.length >= 8, /[A-Z]/.test(pw) && /[a-z]/.test(pw), /\d/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
}

export function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return <span className="vf-label">{children}{required && <b> *</b>}</span>;
}

export function Err({ message }: { message?: string }) {
  return message ? <span className="field-error">{message}</span> : null;
}

export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const score = strength(password);
  return (
    <span className="vf-strength" data-score={score}>
      {[0, 1, 2, 3].map((i) => <i key={i} className={i < score ? 'on' : ''} />)}
      <small>{['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][score]}</small>
    </span>
  );
}
