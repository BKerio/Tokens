import type { BillingFrequency } from '../../generated/prisma/index.js';

/**
 * Pure date maths for rent periods (no I/O, easy to test).
 *
 * Periods follow the calendar: a MONTHLY lease bills each calendar month, a
 * QUARTERLY one each 3-month block starting from its first month, and so on.
 * A lease that starts or ends mid-period is charged pro rata by day. Dates
 * are UTC-midnight `Date`s representing calendar days (Postgres DATE).
 */

export const MONTHS: Record<BillingFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12 };

const DAY = 86_400_000;

export const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-10-21" → UTC-midnight Date. */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return utcDay(y!, m! - 1, d!);
}

/** Today's calendar date in Nairobi (EAT, UTC+3) as a UTC-midnight Date. */
export function todayNairobi(now = new Date()): Date {
  const eat = new Date(now.getTime() + 3 * 3_600_000);
  return utcDay(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate());
}

export interface Period {
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  amount: number;
  /** Start of the following period, or null when the lease ends with this one. */
  next: Date | null;
}

/**
 * The billing period that begins on `periodStart` for a lease.
 * `rent` is the amount for one full period (e.g. a month for MONTHLY).
 */
export function periodFor(
  lease: { rentAmount: number; billingFrequency: BillingFrequency; dueDay: number; endDate: Date | null },
  periodStart: Date,
): Period {
  const months = MONTHS[lease.billingFrequency];
  const anchor = utcDay(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1);
  const fullEnd = addDays(utcDay(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1), -1);
  const end = lease.endDate && lease.endDate < fullEnd ? lease.endDate : fullEnd;

  const fullDays = daysBetween(anchor, fullEnd) + 1;
  const covered = daysBetween(periodStart, end) + 1;
  const amount = covered >= fullDays ? lease.rentAmount : round2((lease.rentAmount * covered) / fullDays);

  const dueDay = Math.min(lease.dueDay, daysInMonth(anchor.getUTCFullYear(), anchor.getUTCMonth()));
  let dueDate = utcDay(anchor.getUTCFullYear(), anchor.getUTCMonth(), dueDay);
  if (dueDate < periodStart) dueDate = periodStart;

  const next = lease.endDate && end >= lease.endDate ? null : addDays(end, 1);
  return { periodStart, periodEnd: end, dueDate, amount, next };
}

/** Rent expressed per month, for rent-roll totals across mixed frequencies. */
export function monthlyEquivalent(rent: number, frequency: BillingFrequency): number {
  return round2(rent / MONTHS[frequency]);
}
