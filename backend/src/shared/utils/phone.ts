/**
 * Normalizes a Kenyan phone number to MSISDN form (2547XXXXXXXX / 2541XXXXXXXX).
 * Returns null when the input doesn't look like a Kenyan mobile number.
 *
 *   0712345678     → 254712345678
 *   +254712345678  → 254712345678
 *   712345678      → 254712345678
 */
export function normalizeMsisdn(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');

  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) return `254${digits}`;

  return null;
}

/**
 * All the spellings a stored phone might use for the same subscriber, so a
 * lookup matches records saved before numbers were normalized
 * (e.g. "0712…" and "254712…").
 */
export function phoneVariants(input: string): string[] {
  const msisdn = normalizeMsisdn(input);
  const raw = input.trim();
  if (!msisdn) return [raw];
  const local = `0${msisdn.slice(3)}`;
  return Array.from(new Set([raw, msisdn, local, `+${msisdn}`]));
}
