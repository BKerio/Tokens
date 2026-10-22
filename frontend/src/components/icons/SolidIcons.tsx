/**
 * Sidebar icon set, flat "solid brand mark" style - a single filled
 * `currentColor` path per icon, no stroke, cropped tight to a 24x24 grid.
 * Modeled on how real brand SVGs (GitHub, X, LinkedIn, ...) are authored:
 * one <path>, `fill="currentColor"`, `fillRule="evenodd"` where a shape
 * needs a cut-out (a gear's hole, an exclamation mark's negative space)
 * instead of layering opacity/stroke tricks.
 *
 * Drop-in compatible with the lucide-react `size` prop so these can replace
 * `<SomeIcon size={20} />` call sites directly.
 */
import type { CSSProperties, ReactNode, SVGProps } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
};

function Svg({ size = 20, className, style, children }: IconProps & { children: ReactNode }) {
  return (
    <svg {...base} width={size} height={size} className={className} style={style}>
      {children}
    </svg>
  );
}

/** Asymmetric panel grid - a tall overview tile plus two stacked summary tiles. */
export function IconDashboard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="8" height="18" />
      <rect x="13" y="3" width="8" height="7" />
      <rect x="13" y="12" width="8" height="9" />
    </Svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      {/* back person, drawn first so the front person overlaps it */}
      <circle cx="17" cy="7" r="2.6" />
      <path d="M13.6 20.5 L14.4 16.3 H19.9 L20.7 20.5 Z" />
      {/* front person */}
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3.2 20.5 L4.3 14.8 H13.7 L14.8 20.5 Z" />
    </Svg>
  );
}

/** Classic layers glyph: a solid top plate with two chevron bars peeking out beneath it. */
export function IconLayers(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 3.5 L20.5 8.5 L12 13.5 L3.5 8.5 Z
           M3.5 13 L12 18 L20.5 13 L20.5 14.6 L12 19.6 L3.5 14.6 Z
           M3.5 16.6 L12 21.6 L20.5 16.6 L20.5 18.2 L12 23.2 L3.5 18.2 Z"
      />
    </Svg>
  );
}

/** Dart-style send arrow (the Telegram-esque paper plane), one solid notched path. */
export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 21 L23 12 L2 3 L2 10 L17 12 L2 14 Z" />
    </Svg>
  );
}

/** Person + hex gear badge, so "user settings" reads distinctly from the plain gear used for Settings. */
export function IconUserCog(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M4 20.5 L5 15 H14 L15 20.5 Z" />
      <path
        fillRule="evenodd"
        d="M22.4 17.3 L21.05 18.56 L21.11 20.41 L19.26 20.35 L18 21.7 L16.74 20.35 L14.89 20.41 L14.95 18.56
           L13.6 17.3 L14.95 16.04 L14.89 14.19 L16.74 14.25 L18 12.9 L19.26 14.25 L21.11 14.19 L21.05 16.04 Z
           M19.4 17.3 A1.4 1.4 0 1 0 16.6 17.3 A1.4 1.4 0 1 0 19.4 17.3 Z"
      />
    </Svg>
  );
}

/** Document silhouette with a folded-corner notch and three cut-out text lines. */
export function IconScrollText(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M6 2.5 H14 L18 6.5 V21.5 H6 Z
           M14 2.5 L18 6.5 H14 Z
           M8.5 10.4 H15.5 V11.6 H8.5 Z
           M8.5 13.9 H15.5 V15.1 H8.5 Z
           M8.5 17.4 H12.5 V18.6 H8.5 Z"
      />
    </Svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 4 V20 L6 12 Z" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4 V20 L18 12 Z" />
    </Svg>
  );
}

export function IconLogOut(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3.5 H9 V20.5 H5 Z M9 11.2 H17 V12.8 H9 Z M17 7.5 L22 12 L17 16.5 Z" />
    </Svg>
  );
}

/** Two stacked coins - the front one carries a thin rim cut-out for coin detail. */
export function IconCoins(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8.5" cy="9" r="5" />
      <path
        fillRule="evenodd"
        d="M15 15 m-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0
           M15 15 m-3.6,0 a3.6,3.6 0 1,0 7.2,0 a3.6,3.6 0 1,0 -7.2,0
           M15 15 m-3.2,0 a3.2,3.2 0 1,0 6.4,0 a3.2,3.2 0 1,0 -6.4,0"
      />
    </Svg>
  );
}

/** Solid warning triangle with the exclamation mark cut out as negative space. */
export function IconTriangleAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M12 2.5 L23 21 H1 Z M11.1 8.5 H12.9 L12.5 15.5 H11.5 Z M11.3 17.3 H12.7 V18.7 H11.3 Z"
      />
    </Svg>
  );
}

export function IconBarChart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 12 H8 V21 H3.5 Z M10 6.5 H14.5 V21 H10 Z M16.5 3 H21 V21 H16.5 Z" />
    </Svg>
  );
}

/** Real gear silhouette (8 pointed teeth via alternating radius) with the bolt hole cut out. */
export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fillRule="evenodd"
        d="M22.3 12 L19.21 14.99 L19.28 19.28 L14.99 19.21 L12 22.3 L9.01 19.21 L4.72 19.28 L4.79 14.99
           L1.7 12 L4.79 9.01 L4.72 4.72 L9.01 4.79 L12 1.7 L14.99 4.79 L19.28 4.72 L19.21 9.01 Z
           M15.4 12 A3.4 3.4 0 1 0 8.6 12 A3.4 3.4 0 1 0 15.4 12 Z"
      />
    </Svg>
  );
}
