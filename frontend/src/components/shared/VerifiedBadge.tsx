import { useId } from 'react';

/** Smooth 8-lobed rosette (the familiar "verified" seal), computed once on a 24px grid. */
const ROSETTE = (() => {
  const lobes = 8;
  const steps = 96;
  const pts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = 10.6 - 1.15 * (1 - Math.cos(lobes * t)) / 2;
    pts.push(`${(12 + r * Math.cos(t)).toFixed(2)},${(12 + r * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

/** Verified seal shown beside a signed-in account's name. */
function VerifiedBadge({ size = 18, title = 'Verified account' }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      className="verified-badge"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      style={{ flexShrink: 0, marginLeft: 5 }}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={`vb-${id}`} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4C8DFF" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </linearGradient>
      </defs>
      <path d={ROSETTE} fill={`url(#vb-${id})`} />
      <path d={ROSETTE} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={0.6} transform="translate(12 12) scale(.88) translate(-12 -12)" />
      <path d="M7.6 12.4l3 3 5.8-6.1" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default VerifiedBadge;
