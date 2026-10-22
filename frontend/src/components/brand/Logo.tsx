import type { CSSProperties } from 'react';
import mark from '@/assets/logos/tokenpap-mark.svg';
import markWhite from '@/assets/logos/tokenpap-mark-white.svg';
import wordmark from '@/assets/logos/brand-wordmark.png';
import wordmarkWhite from '@/assets/logos/brand-wordmark-white.png';
import lockup from '@/assets/logos/brand-lockup.png';
import lockupWhite from '@/assets/logos/brand-lockup-white.png';

export const APP_NAME = 'TokenPap';
export const TAGLINE = 'Smart Metering & Vending Solutions';

const IMG: CSSProperties = { display: 'inline-block', objectFit: 'contain', flexShrink: 0 };

/**
 * Brand assets (src/assets/logos): the mark is the vector `tokenpap-mark.svg`;
 * the wordmark and lockup are cut from the designer's `tokenpap(white).png`
 * with the background removed. `onDark` switches to the white-ink variants
 * (from `tokenpap(black).png`) for navy or photo backgrounds.
 */

/** The TokenPap "T" meter mark. */
export function LogoMark({ size = 24, className, title, style, onDark }: { size?: number; className?: string; title?: string; style?: CSSProperties; onDark?: boolean }) {
  return (
    <img
      src={onDark ? markWhite : mark}
      width={size}
      height={size}
      className={className}
      style={{ ...IMG, ...style }}
      draggable={false}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
    />
  );
}

// The wordmark artwork is 906×194 with the cap height at ~72% of its height.
const WORD_RATIO = 906 / 194;
const CAP = 0.72;

/** "TokenPap" lettering (`height` ≈ cap height in px). */
export function Wordmark({ height = 14, className, style, onDark }: { height?: number; className?: string; style?: CSSProperties; onDark?: boolean }) {
  const h = Math.round(height / CAP);
  return (
    <img src={onDark ? wordmarkWhite : wordmark} width={Math.round(h * WORD_RATIO)} height={h} className={className} style={{ ...IMG, ...style }} draggable={false} alt={APP_NAME} />
  );
}

// Full lockup (mark + wordmark + teal rule + tagline) is 1270×297.
const LOCKUP_RATIO = 1270 / 297;

/** The complete logo with the "Smart Metering & Vending Solutions" tagline. */
export function LogoLockup({ height = 48, className, style, onDark }: { height?: number; className?: string; style?: CSSProperties; onDark?: boolean }) {
  return (
    <img
      src={onDark ? lockupWhite : lockup}
      width={Math.round(height * LOCKUP_RATIO)}
      height={height}
      className={className}
      style={{ ...IMG, maxWidth: '100%', height: 'auto', ...style }}
      draggable={false}
      alt={`${APP_NAME} - ${TAGLINE}`}
    />
  );
}
