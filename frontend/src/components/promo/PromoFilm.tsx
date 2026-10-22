import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Calculator, Camera, CardSim, ChevronLeft, ChevronRight, CloudSun, Compass, Copy, Delete, Folder, Heart, ListChecks, Mail,
  Map as MapIcon, MessageCircle, Music, Navigation, NotebookPen, Paintbrush, Phone, Settings, SquarePlus, Sun, Video, Wallet, Zap,
} from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/brand/Logo';

/**
 * The hero iPhone film: buying a token the way most customers actually do it.
 * Home screen (opens in edit mode and adds the TokenPap widget) → SIM Toolkit → M-PESA → Lipa na M-PESA → Pay Bill → business
 * no. (NCBA paybill) → account no. (vendor till#meter number) → amount → PIN →
 * confirm, then the M-PESA receipt and the token SMS drop in as notifications.
 *
 * Drawn in code from one timeline (seconds); every frame is a pure function
 * of `t`, so any moment can be frozen with ?film=12.3 for review.
 */

const BASE_DURATION = 28; // the paybill story; the edit-mode intro (INTRO) is added in front
const W = 308; // design size; the film scales to the actual screen
const H = 682;

/** NCBA paybill customers pay into (backend NCBA_PAYBILL_SHORTCODE). */
export const PAYBILL = '880100';
const METER = '47500162848';
/** NCBA only accepts "<vendor till>#<meter no.>" - a bare meter number bounces as an invalid account. */
const ACCOUNT = `218262#${METER}`;
const AMOUNT = '500';
const TOKEN = '45219087331266041180';
const TOKEN_DASHED = TOKEN.match(/.{1,4}/g)!.join('-');

// ── Timing helpers ────────────────────────────────────────────────────────────
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const backOut = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

/** Opacity + lift + de-blur reveal. */
function rise(t: number, at: number, dur = 0.45, dist = 14): CSSProperties {
  const e = easeOut(prog(t, at, dur));
  return { opacity: e, transform: `translateY(${(1 - e) * dist}px)`, filter: e < 1 ? `blur(${(1 - e) * 5}px)` : undefined };
}

function pop(t: number, at: number, dur = 0.5): CSSProperties {
  const x = prog(t, at, dur);
  return { opacity: clamp(x * 3), transform: `scale(${0.6 + 0.4 * (x === 0 ? 0 : backOut(x))})` };
}

function Words({ t, at, words, gap = 0.1 }: { t: number; at: number; words: string[]; gap?: number }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          <span className="pf-word" style={rise(t, at + i * gap)}>{w}</span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

/** Keypad typing speed (digits per second). */
const CPS = 9;
const typedCount = (t: number, at: number, len: number) => Math.floor(clamp((t - at) * CPS, 0, len));

/** iOS push: the new screen slides in from the right. */
const push = (lt: number): CSSProperties => ({ transform: `translateX(${(1 - easeInOut(prog(lt, 0, 0.42))) * 100}%)`, boxShadow: '-12px 0 30px rgba(0,0,0,.12)' });

/** A finger tap: a soft circle that presses in and fades. */
function Tap({ lt, at, x, y }: { lt: number; at: number; x: number; y: number }) {
  const p = prog(lt, at - 0.18, 0.55);
  if (p <= 0 || p >= 1) return null;
  const press = Math.sin(p * Math.PI);
  return <span className="pf-tap" style={{ left: x, top: y, opacity: press * 0.9, transform: `translate(-50%, -50%) scale(${0.6 + press * 0.5})` }} />;
}

// ── Home screen (iOS 18: widgets, 4×4 grid, glass dock, edit menu) ─────────────

type App = { label: string; Icon?: typeof Phone; text?: string; bg: string; fg?: string };

const APPS: App[] = [
  { label: 'Calendar', bg: '#fff' },
  { label: 'FaceTime', Icon: Video, bg: 'linear-gradient(180deg,#5EE07A,#22B847)' },
  { label: 'Mail', Icon: Mail, bg: 'linear-gradient(180deg,#4FB2FF,#1170F0)' },
  { label: 'Clock', bg: '#111' },
  { label: 'Camera', Icon: Camera, bg: 'linear-gradient(180deg,#E4E4E9,#A4A4AC)', fg: '#2C2C2E' },
  { label: 'Weather', Icon: CloudSun, bg: 'linear-gradient(180deg,#4FA3F7,#2266D6)' },
  { label: 'Notes', Icon: NotebookPen, bg: 'linear-gradient(180deg,#FFD84D 0 26%,#fff 26%)', fg: '#A07800' },
  { label: 'Reminders', Icon: ListChecks, bg: '#fff', fg: '#FF9500' },
  { label: 'Maps', Icon: MapIcon, bg: 'linear-gradient(135deg,#8BE29C,#F4E78A)', fg: '#1F6FE5' },
  { label: 'Health', Icon: Heart, bg: '#fff', fg: '#FF2D55' },
  { label: 'Wallet', Icon: Wallet, bg: '#111' },
  { label: 'Settings', Icon: Settings, bg: 'linear-gradient(180deg,#B9B9C0,#7C7C85)' },
  { label: 'Files', Icon: Folder, bg: '#fff', fg: '#1E90FF' },
  { label: 'Calculator', Icon: Calculator, bg: '#1C1C1E', fg: '#FF9F0A' },
  { label: 'M-PESA', text: 'M', bg: 'linear-gradient(180deg,#3DCB6A,#0E9F45)' },
  { label: 'SIM Toolkit', Icon: CardSim, bg: 'linear-gradient(180deg,#5AB0FF,#1B6FE0)' },
];
const DOCK: App[] = [
  { label: 'Phone', Icon: Phone, bg: 'linear-gradient(180deg,#5EE07A,#22B847)' },
  { label: 'Messages', Icon: MessageCircle, bg: 'linear-gradient(180deg,#5EE07A,#22B847)' },
  { label: 'Safari', Icon: Compass, bg: 'linear-gradient(180deg,#fff,#E4E9F2)', fg: '#1F6FE5' },
  { label: 'Music', Icon: Music, bg: 'linear-gradient(180deg,#FF6E7F,#FA2D48)' },
];

// Geometry: a row of two 2×2 widgets, then a 4-column grid. Also the tap/zoom origins.
const ICON = 54;
const GRID_X = 22;
const GRID_GAP = (W - GRID_X * 2 - ICON * 4) / 3;
const WIDGET = ICON * 2 + GRID_GAP;
const WIDGET_Y = 58;
const GRID_Y = WIDGET_Y + WIDGET + 30;
const ROW_H = 78;
const appX = (i: number) => GRID_X + (i % 4) * (ICON + GRID_GAP);
const appY = (i: number) => GRID_Y + Math.floor(i / 4) * ROW_H;
const SIM_INDEX = APPS.findIndex((a) => a.label === 'SIM Toolkit');
const SIM_X = appX(SIM_INDEX) + ICON / 2;
const SIM_Y = appY(SIM_INDEX) + ICON / 2;

// Edit-mode chrome: "Edit" / "Done" pills beside the Dynamic Island, and the Edit menu.
const PILL_Y = 26; // pill centre
const PILL_CX = 38;
const MENU_TOP = 44;
const MENU_ROW = 34;
const MENU: [string, typeof Phone][] = [['Add Widget', SquarePlus], ['Customize', Paintbrush], ['Edit Pages', Copy]];

/** Seconds of edit-mode intro played on the home screen before the SIM Toolkit tap. */
const INTRO = 3;
export const FILM_DURATION = BASE_DURATION + INTRO;

function ClockFace() {
  const hand = (deg: number, len: number, w: number, color: string) => {
    const r = ((deg - 90) * Math.PI) / 180;
    return <line x1={0} y1={0} x2={Math.cos(r) * len} y2={Math.sin(r) * len} stroke={color} strokeWidth={w} strokeLinecap="round" />;
  };
  return (
    <svg width="48" height="48" viewBox="-24 -24 48 48">
      <circle r="23" fill="#fff" />
      {Array.from({ length: 12 }, (_, i) => {
        const r = (i * Math.PI) / 6;
        return <line key={i} x1={Math.cos(r) * 17.5} y1={Math.sin(r) * 17.5} x2={Math.cos(r) * 20.5} y2={Math.sin(r) * 20.5} stroke="#1C1C1E" strokeWidth={i % 3 === 0 ? 1.6 : 0.8} />;
      })}
      {hand(290.5, 10, 2.4, '#1C1C1E') /* 9:41 */}
      {hand(246, 15.5, 1.7, '#1C1C1E')}
      {hand(36, 18, 0.8, '#FF9500')}
      <circle r="1.7" fill="#FF9500" />
    </svg>
  );
}

function AppIcon({ app, pressed = false }: { app: App; pressed?: boolean }) {
  return (
    <span className="pf-app-ico" style={{ background: app.bg, color: app.fg ?? '#fff', transform: pressed ? 'scale(.88)' : undefined, filter: pressed ? 'brightness(.8)' : undefined }}>
      {app.label === 'Calendar' ? <span className="pf-cal"><em>FRI</em><b>16</b></span>
        : app.label === 'Clock' ? <ClockFace />
        : app.Icon ? <app.Icon size={26} strokeWidth={1.9} />
        : <b>{app.text}</b>}
    </span>
  );
}

function WeatherWidget() {
  return (
    <div className="pf-widget pf-weather">
      <span className="pf-w-city">Nairobi <Navigation size={8} fill="currentColor" strokeWidth={0} /></span>
      <b className="pf-w-temp">24°</b>
      <span className="pf-w-foot"><Sun size={14} color="#FFD43B" fill="#FFD43B" strokeWidth={2.2} /><span>Mostly Sunny</span><span>H:27° L:15°</span></span>
    </div>
  );
}

function PhotosWidget() {
  return (
    <div className="pf-widget pf-photo">
      <i className="pf-photo-sun" />
      <i className="pf-photo-hill a" />
      <i className="pf-photo-hill b" />
      <span className="pf-photo-cap"><small>On this day</small>Naivasha</span>
    </div>
  );
}

/** TokenPap's own widget: units left on the meter, ring turns green once topped up. */
function MeterWidget({ units, glow = 0 }: { units: number; glow?: number }) {
  const low = units < 5;
  const C = 2 * Math.PI * 25;
  const frac = clamp(units / 25);
  return (
    <div className="pf-widget pf-meterw" style={glow ? { boxShadow: `0 0 0 ${2 * glow}px #34C759, 0 0 ${24 * glow}px rgba(52,199,89,.6)` } : undefined}>
      <span className="pf-mw-head"><LogoMark size={15} /> Meter ···2848</span>
      <span className="pf-mw-ring">
        <svg width="62" height="62" viewBox="-31 -31 62 62">
          <circle r="25" fill="none" stroke="#EEF0F4" strokeWidth="6" />
          <circle r="25" fill="none" stroke={low ? '#FF9500' : '#34C759'} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90)" />
        </svg>
        <span><b>{units.toFixed(1)}</b><small>kWh</small></span>
      </span>
      <span className={`pf-mw-foot${low ? ' low' : ''}`}><Zap size={9} fill="currentColor" strokeWidth={0} />{low ? 'Low · top up' : 'Topped up · ~9 days'}</span>
    </div>
  );
}

interface HomeProps {
  /** 0..1: how far into edit mode (Edit / Done pills shown). */
  edit?: number;
  /** 0..1: the Edit menu popover. */
  menu?: number;
  menuHot?: number | null;
  /** Which edit pill is under the finger. */
  pill?: 'edit' | 'done' | null;
  /** 0..1: Photos widget swapped out for the TokenPap meter widget. */
  widget?: number;
  units?: number;
  glow?: number;
  pressSim?: boolean;
}

function HomeScreen({ edit = 0, menu = 0, menuHot = null, pill = null, widget = 1, units = 3.2, glow = 0, pressSim = false }: HomeProps) {
  const swapIn = widget <= 0 ? 0 : backOut(widget);
  return (
    <div className="pf-scene pf-home">
      <div className="pf-wall"><i className="w1" /><i className="w2" /><i className="w3" /></div>

      {/* Widgets row */}
      <span className="pf-wslot" style={{ left: GRID_X, top: WIDGET_Y }}>
        <WeatherWidget />
        <span className="pf-app-label">Weather</span>
      </span>
      <span className="pf-wslot" style={{ left: GRID_X + WIDGET + GRID_GAP, top: WIDGET_Y }}>
        {widget < 1 && <span className="pf-wlayer" style={{ opacity: 1 - widget, transform: `scale(${1 - 0.25 * widget})` }}><PhotosWidget /></span>}
        {widget > 0 && <span className="pf-wlayer" style={{ opacity: clamp(widget * 3), transform: `scale(${0.55 + 0.45 * swapIn})` }}><MeterWidget units={units} glow={glow} /></span>}
        <span className="pf-app-label">{widget > 0.5 ? 'TokenPap' : 'Photos'}</span>
      </span>

      <div className="pf-apps">
        {APPS.map((app, i) => (
          <span key={app.label} className="pf-app" style={{ left: appX(i), top: appY(i) }}>
            <AppIcon app={app} pressed={pressSim && i === SIM_INDEX} />
            <span className="pf-app-label">{app.label}</span>
          </span>
        ))}
      </div>
      <div className="pf-page-dots"><i className="on" /><i /><i /></div>
      <div className="pf-dock">
        {DOCK.map((app) => <AppIcon key={app.label} app={app} />)}
      </div>

      {edit > 0 && (
        <>
          <div className="pf-home-dim" style={{ opacity: menu * 0.32 }} />
          <span className={`pf-edit-pill${pill === 'edit' || menu > 0.5 ? ' on' : ''}`} style={{ left: PILL_CX - 22, opacity: edit }}>Edit</span>
          <span className={`pf-edit-pill${pill === 'done' ? ' on' : ''}`} style={{ right: PILL_CX - 22, opacity: edit }}>Done</span>
          {menu > 0 && (
            <div className="pf-menu" style={{ top: MENU_TOP, opacity: clamp(menu * 2), transform: `scale(${0.5 + 0.5 * easeOut(menu)})` }}>
              {MENU.map(([label, Icon], i) => (
                <div key={label} className={`pf-menu-row${menuHot === i ? ' on' : ''}`} style={{ height: MENU_ROW }}>
                  <span>{label}</span>
                  <Icon size={14} strokeWidth={2} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── SIM Toolkit screens ───────────────────────────────────────────────────────

const LIST_TOP = 132; // first row's top edge
const ROW = 44;

function NavBar({ title, back, action, actionOn }: { title: string; back?: string; action?: string; actionOn?: boolean }) {
  return (
    <div className="pf-nav">
      {back ? <span className="pf-nav-back"><ChevronLeft size={18} strokeWidth={2.4} />{back}</span> : <span />}
      <b className="pf-nav-title">{title}</b>
      {action ? <span className={`pf-nav-action${actionOn ? ' on' : ''}`}>{action}</span> : <span />}
    </div>
  );
}

function StkList({ lt, title, back, header, items, tap }: { lt: number; title: string; back?: string; header: string; items: string[]; tap: { index: number; at: number } }) {
  const tapped = lt > tap.at - 0.05;
  return (
    <div className="pf-scene pf-ios">
      <NavBar title={title} back={back} />
      <span className="pf-list-head">{header}</span>
      <div className="pf-list" style={{ top: LIST_TOP }}>
        {items.map((item, i) => (
          <div key={item} className={`pf-li${tapped && i === tap.index ? ' on' : ''}`}>
            <span>{item}</span>
            <ChevronRight size={15} strokeWidth={2.2} />
          </div>
        ))}
      </div>
      <Tap lt={lt} at={tap.at} x={150} y={LIST_TOP + tap.index * ROW + ROW / 2} />
    </div>
  );
}

const ALERT_TOP = 236;
const ALERT_H = 168;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '#', '0', 'del'];
const KEY_LETTERS: Record<string, string> = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ' };

/** An STK input prompt: field + numeric keypad, typed one key at a time, then Send. */
function StkInput({ lt, title, back, prompt, value, typeAt, sendAt, secret = false }: {
  lt: number; title: string; back: string; prompt: string; value: string; typeAt: number; sendAt: number; secret?: boolean;
}) {
  const n = typedCount(lt, typeAt, value.length);
  const shown = value.slice(0, n);
  // The key under the finger right now: the last digit, for a beat after it lands.
  const sinceKey = (lt - typeAt) * CPS - n; // 0..1 through the current keystroke
  const activeKey = n > 0 && sinceKey < 0.6 ? value[n - 1] : null;
  const ready = n === value.length;

  return (
    <div className="pf-scene pf-ios">
      <NavBar title={title} back={back} action="Send" actionOn={ready} />
      <span className="pf-prompt">{prompt}</span>
      <div className="pf-field">
        <span className={secret ? 'pf-secret' : undefined}>{secret ? '•'.repeat(n) : shown}</span>
        {lt < sendAt && <i className="pf-caret" />}
      </div>
      <div className="pf-kb">
        {KEYS.map((k, i) => (
          <span key={i} className={`pf-key${k === '' ? ' blank' : ''}${k === 'del' ? ' fn' : ''}${activeKey === k ? ' on' : ''}`}>
            {k === 'del' ? <Delete size={18} /> : k && (<><b>{k}</b><small>{KEY_LETTERS[k] ?? ''}</small></>)}
          </span>
        ))}
      </div>
      <Tap lt={lt} at={sendAt} x={272} y={72} />
    </div>
  );
}

// ── Notification banner ───────────────────────────────────────────────────────

function Banner({ y, sender, body, highlight }: { y: number; sender: string; body: ReactNode; highlight?: boolean }) {
  return (
    <div className={`pf-banner${highlight ? ' hot' : ''}`} style={{ transform: `translateY(${y}px)` }}>
      <span className="pf-banner-ico"><MessageCircle size={16} strokeWidth={2.2} fill="currentColor" /></span>
      <div className="pf-banner-main">
        <div className="pf-banner-head"><b>{sender}</b><span>now</span></div>
        <div className="pf-banner-body">{body}</div>
      </div>
    </div>
  );
}

/** Banner drop: slides down from above the screen, and back up when `outAt` is set. */
function bannerY(lt: number, inAt: number, outAt?: number) {
  const inP = backOut(prog(lt, inAt, 0.55));
  const outP = outAt === undefined ? 0 : easeInOut(prog(lt, outAt, 0.4));
  return -190 + inP * 246 - outP * 246;
}

// ── Chapters ──────────────────────────────────────────────────────────────────

interface Chapter { start: number; end: number; label: string; dark?: boolean; render: (lt: number) => ReactNode; enter: (lt: number) => CSSProperties }

// Times below are on the 28s paybill story; every chapter after 'home' is shifted by INTRO.
const STORY: Chapter[] = [
  {
    // Opens jiggling in edit mode: Edit → Add Widget drops in the TokenPap meter
    // widget (low on units) → Done, then the usual SIM Toolkit tap.
    start: 0, end: 2.75, label: 'home', dark: true,
    enter: (lt) => ({ opacity: easeOut(prog(lt, 0, 0.35)) }),
    render: (lt) => {
      const s = lt - INTRO;
      return (
        <>
          <HomeScreen
            edit={1 - easeOut(prog(lt, 2.4, 0.3))}
            menu={easeOut(prog(lt, 0.6, 0.3)) * (1 - easeOut(prog(lt, 1.45, 0.2)))}
            menuHot={lt > 1.2 && lt < 1.5 ? 0 : null}
            pill={lt > 0.45 && lt < 0.75 ? 'edit' : lt > 2.2 && lt < 2.45 ? 'done' : null}
            widget={prog(lt, 1.6, 0.6)}
            pressSim={s > 1.45 && s < 1.9}
          />
          <Tap lt={lt} at={0.6} x={PILL_CX} y={PILL_Y} />
          <Tap lt={lt} at={1.3} x={84} y={MENU_TOP + MENU_ROW / 2} />
          <Tap lt={lt} at={2.3} x={W - PILL_CX} y={PILL_Y} />
          <Tap lt={lt} at={INTRO + 1.6} x={SIM_X} y={SIM_Y} />
        </>
      );
    },
  },
  {
    start: 2.2, end: 4.75, label: 'sim toolkit',
    // The app zooms open out of its icon.
    enter: (lt) => {
      const e = easeInOut(prog(lt, 0, 0.5));
      return { transformOrigin: `${SIM_X}px ${SIM_Y}px`, transform: `scale(${0.12 + 0.88 * e})`, opacity: clamp(e * 2.5), borderRadius: `${(1 - e) * 40}px`, overflow: 'hidden' };
    },
    render: (lt) => (
      <StkList lt={lt} title="Safaricom" header="SIM TOOLKIT" items={['Safaricom+', 'M-PESA', 'Bonga Points', 'Data Bundles', 'Tunukiwa Offers']} tap={{ index: 1, at: 1.55 }} />
    ),
  },
  {
    start: 4.35, end: 6.75, label: 'm-pesa', enter: push,
    render: (lt) => (
      <StkList lt={lt} title="M-PESA" back="Safaricom" header="M-PESA MENU" items={['Send Money', 'Withdraw Cash', 'Buy Airtime', 'Loans and Savings', 'Lipa na M-PESA', 'My Account']} tap={{ index: 4, at: 1.5 }} />
    ),
  },
  {
    start: 6.35, end: 8.55, label: 'lipa na m-pesa', enter: push,
    render: (lt) => (
      <StkList lt={lt} title="Lipa na M-PESA" back="M-PESA" header="LIPA NA M-PESA" items={['Pay Bill', 'Buy Goods and Services']} tap={{ index: 0, at: 1.25 }} />
    ),
  },
  {
    start: 8.15, end: 10.65, label: 'business no', enter: push,
    render: (lt) => <StkInput lt={lt} title="Pay Bill" back="Back" prompt="Enter business no." value={PAYBILL} typeAt={0.55} sendAt={1.85} />,
  },
  {
    start: 10.25, end: 13.25, label: 'account no', enter: push,
    render: (lt) => <StkInput lt={lt} title="Pay Bill" back="Back" prompt="Enter account no. (till#meter no.)" value={ACCOUNT} typeAt={0.5} sendAt={2.4} />,
  },
  {
    start: 12.85, end: 14.95, label: 'amount', enter: push,
    render: (lt) => <StkInput lt={lt} title="Pay Bill" back="Back" prompt="Enter amount" value={AMOUNT} typeAt={0.5} sendAt={1.4} />,
  },
  {
    start: 14.55, end: 16.65, label: 'pin', enter: push,
    render: (lt) => <StkInput lt={lt} title="Pay Bill" back="Back" prompt="Enter M-PESA PIN" value="2580" secret typeAt={0.5} sendAt={1.4} />,
  },
  {
    start: 16.25, end: 18.75, label: 'confirm',
    enter: (lt) => ({ opacity: easeOut(prog(lt, 0, 0.25)) }),
    render: (lt) => {
      const sending = lt > 1.55;
      return (
        <div className="pf-scene pf-ios">
          <NavBar title="Pay Bill" back="Back" action="Send" actionOn />
          <span className="pf-prompt">Enter M-PESA PIN</span>
          <div className="pf-field"><span className="pf-secret">••••</span></div>
          <div className="pf-alert-dim" style={{ opacity: easeOut(prog(lt, 0.2, 0.25)) }} />
          <div className="pf-alert" style={{ top: ALERT_TOP, height: ALERT_H, ...pop(lt, 0.25, 0.4) }}>
            <b>M-PESA</b>
            {sending ? (
              <p className="pf-sending"><span className="pf-spin" /> Sending request…</p>
            ) : (
              <p>Pay Ksh{AMOUNT}.00 to <b>NCBA BANK KENYA PLC</b> for account <b>{ACCOUNT}</b>?</p>
            )}
            {!sending && (
              <div className="pf-alert-btns">
                <span>Cancel</span>
                <span className={lt > 1.1 ? 'on' : undefined}>OK</span>
              </div>
            )}
          </div>
          {/* OK button centre: right half of the alert's button row (see .pf-alert in landing.css). */}
          <Tap lt={lt} at={1.2} x={W / 2 + 62} y={ALERT_TOP + ALERT_H - 22} />
        </div>
      );
    },
  },
  {
    start: 18.35, end: 24.8, label: 'token sms', dark: true,
    // The toolkit closes back to the home screen; the SMSes drop in from the top.
    enter: (lt) => ({ opacity: easeOut(prog(lt, 0, 0.35)), transform: `scale(${1.06 - 0.06 * easeOut(prog(lt, 0, 0.45))})` }),
    render: (lt) => (
      <>
        {/* Once the token SMS is read, the meter widget refills: 3.2 + 17.3 kWh. */}
        <HomeScreen units={3.2 + 17.3 * easeInOut(prog(lt, 4.55, 0.8))} glow={prog(lt, 4.45, 0.3) * (1 - prog(lt, 5.6, 0.5))} />
        <div className="pf-home-scrim" style={{ opacity: easeOut(prog(lt, 3.5, 0.5)) }} />
        <Banner
          y={bannerY(lt, 0.7, 2.35)}
          sender="MPESA"
          body={<>QJK7XB2LMN Confirmed. Ksh{AMOUNT}.00 sent to NCBA BANK KENYA PLC for account {ACCOUNT} on 16/10/26 at 9:41 AM.</>}
        />
        <Banner
          y={bannerY(lt, 2.75, 4.25)}
          sender="TOKENPAP"
          highlight={lt > 3.4}
          body={
            <>
              Token purchase Successful<br />
              Mtr: {METER}<br />
              Token: <b className="pf-banner-token">{TOKEN_DASHED}</b><br />
              Units: 17.3 · Amt: {AMOUNT}.00
            </>
          }
        />
        <span className="pf-home-caption" style={rise(lt, 3.6, 0.5, 18)}>
          Token on your phone<br /><span className="pf-serif">in seconds.</span>
        </span>
      </>
    ),
  },
  {
    start: 24.4, end: BASE_DURATION + 0.01, label: 'tokenpap',
    enter: (lt) => ({ clipPath: `circle(${easeInOut(prog(lt, 0, 0.55)) * 120}% at 50% 42%)` }),
    render: (lt) => (
      <div className="pf-scene pf-white pf-end">
        <span style={pop(lt, 0.3, 0.6)}><LogoMark size={104} /></span>
        <div style={{ clipPath: `inset(0 ${(1 - easeInOut(prog(lt, 1.0, 0.6))) * 100}% 0 0)`, marginTop: 22 }}>
          <Wordmark height={20} style={{ color: '#000' }} />
        </div>
        <p className="pf-tagline">
          <Words t={lt} at={1.5} words={['Paybill', PAYBILL, '·', 'Account:']} gap={0.08} />
          <br />
          <span className="pf-serif pf-blue pf-word" style={{ ...rise(lt, 1.9, 0.5, 14), fontSize: 30 }}>till#meter no.</span>
        </p>
        <span className="pf-cta" style={pop(lt, 2.3, 0.45)}>Buy tokens</span>
        <span className="pf-mono pf-foot" style={rise(lt, 2.5)}>m-pesa · sts · sms</span>
      </div>
    ),
  },
];

const CHAPTERS: Chapter[] = STORY.map((c) =>
  c.label === 'home' ? { ...c, end: c.end + INTRO } : { ...c, start: c.start + INTRO, end: c.end + INTRO },
);

/** Home-screen edit mode hides the status bar (the Edit / Done pills take its place). */
export function homeEditingAt(t: number): boolean {
  return t < 2.7;
}

/** Whether the frontmost chapter at time t is dark, so the phone's status bar flips to white. */
export function filmIsDark(t: number): boolean {
  // A chapter only counts once its entry has covered the top of the screen,
  // otherwise white chrome would sit on the outgoing (light) scene.
  const covering = CHAPTERS.filter((c) => t >= c.start + 0.3 && t < c.end);
  const top = covering[covering.length - 1] ?? CHAPTERS.find((c) => t >= c.start && t < c.end);
  return !!top && !!top.dark;
}

/** What the phone's Dynamic Island shows at time t (while the payment is being sent). */
export function islandAt(t: number): string | null {
  if (t > 17.85 + INTRO && t < 19.0 + INTRO) return 'M-PESA · Sending Ksh500';
  return null;
}

/** Drives the film: a looping rAF clock, paused offscreen. `?film=8.2` freezes it for review. */
export function useFilmClock(): number {
  const frozen = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('film') : null;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Reduced motion: hold on the token SMS, the frame that tells the whole story.
  const [t, setT] = useState(frozen ? Number(frozen) : reduced ? 22.3 + INTRO : 0);

  useEffect(() => {
    if (frozen || reduced) return;
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (now: number) => {
      elapsed = (elapsed + Math.min(now - last, 100) / 1000) % FILM_DURATION;
      last = now;
      setT(elapsed);
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); }
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVisibility); };
  }, [frozen, reduced]);

  return t;
}

/** The film, scaled to fill whatever box it's placed in (the phone screen). */
function PromoFilm({ t }: { t: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const active = CHAPTERS.filter((c) => t >= c.start && t < c.end);

  return (
    <div className="pf-box" ref={boxRef}>
      <div className="pf-stage" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        {active.map((c) => (
          <div key={c.label} className="pf-layer" style={c.enter(t - c.start)}>
            {c.render(t - c.start)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default PromoFilm;
