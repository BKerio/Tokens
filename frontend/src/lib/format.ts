import type { Money } from '@/types/api';

/** Decimal-as-string or number → number (null/undefined → 0). */
export function toNum(value: Money | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** "KES 1,234.50" */
export function fmtKes(value: Money | null | undefined): string {
  return `KES ${toNum(value).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact for stat tiles: "KES 12.4K" */
export function fmtKesShort(value: Money | null | undefined): string {
  const n = toNum(value);
  if (Math.abs(n) >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `KES ${(n / 1_000).toFixed(1)}K`;
  return fmtKes(n);
}

/** STS token digits grouped in fours: "1234 5678 9012 3456 7890". */
export function fmtToken(token: string, sep = ' '): string {
  return token.match(/.{1,4}/g)?.join(sep) ?? token;
}

/** "SET_MAX_OVERDRAFT" → "Set max overdraft" */
export function humanize(value: string | null | undefined): string {
  if (!value) return '-';
  const s = value.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Pill class for any status-ish enum value. */
export function statusPill(status: string | null | undefined): string {
  switch (status) {
    case 'ACTIVE':
    case 'SUCCESS':
    case 'CONFIRMED':
    case 'REVIEWED':
      return 'pill pill-green';
    case 'PENDING':
    case 'MAINTENANCE':
      return 'pill pill-amber';
    case 'FAILED':
    case 'SUSPENDED':
    case 'REJECTED':
      return 'pill pill-red';
    default:
      return 'pill pill-gray';
  }
}

/** Reads an image File as a data: URL (for the logo upload). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Copies text, resolving false when the clipboard isn't available. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
