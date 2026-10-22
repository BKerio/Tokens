import Swal from 'sweetalert2';

/**
 * Central SweetAlert2 wrapper - every popup/toast/confirm dialog in the app
 * should go through here so styling stays consistent and on-brand.
 */

const BUTTON_STYLING = { buttonsStyling: false } as const;

const ICON_COLOR: Record<'success' | 'error' | 'warning' | 'info' | 'question', string> = {
  success: '#169A5B',
  error: '#D62828',
  warning: '#B7791F',
  info: '#2563EB',
  question: '#1E3A8A',
};

/** Toast-style popup in the top-right corner, auto-dismisses - for success/info/warning/error notices. */
export function notify(type: 'success' | 'error' | 'warning' | 'info', title: string, message?: string) {
  return Swal.fire({
    ...BUTTON_STYLING,
    toast: true,
    position: 'top-end',
    icon: type,
    iconColor: ICON_COLOR[type],
    title,
    text: message,
    showConfirmButton: false,
    timer: 5000,
    timerProgressBar: true,
    customClass: { popup: 'swal-toast' },
  });
}

/** Small line icons (Lucide paths) for the subject card of a confirm dialog. */
const ICON_PATHS = {
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  door: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
} as const;

export type DialogIcon = keyof typeof ICON_PATHS;

const svg = (name: DialogIcon, size = 18) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button and destructive styling. */
  danger?: boolean;
  /** The thing being acted on, shown as a card (initials for people when `icon` is 'person'). */
  subject?: { name: string; detail?: string | null; icon?: DialogIcon | 'person' };
  /** What goes away (shown with ✕) and what stays (shown with ✓). */
  removes?: string[];
  keeps?: string[];
  /** Tag the dialog "Can't be undone". */
  irreversible?: boolean;
  /** Make the user type this (e.g. the name) before the confirm button unlocks. */
  typeToConfirm?: string;
}

/**
 * Centered confirmation in the sign-out style: big title, a card naming the
 * subject, what will be removed / kept, then stacked pill buttons. Resolves
 * true if confirmed, false if cancelled or dismissed.
 */
export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const tone = opts.danger ? 'danger' : 'calm';
  const subject = opts.subject;
  const badge = subject?.icon === 'person'
    ? `<span class="swal-cf-av person">${escapeHtml(initialsOf(subject.name))}</span>`
    : `<span class="swal-cf-av">${svg((subject?.icon as DialogIcon) ?? (opts.danger ? 'trash' : 'check'))}</span>`;

  const list = (items: string[] | undefined, kind: 'removes' | 'keeps') => (items?.length
    ? `<div class="swal-cf-list ${kind}">
        <p>${kind === 'removes' ? 'Will be removed' : 'Stays safe'}</p>
        <ul>${items.map((i) => `<li><span>${svg(kind === 'removes' ? 'x' : 'check', 13)}</span>${escapeHtml(i)}</li>`).join('')}</ul>
      </div>`
    : '');

  const html = `
    ${opts.irreversible ? `<span class="swal-cf-tag">${svg('lock', 12)} Can’t be undone</span>` : ''}
    ${subject ? `
      <div class="swal-cf-subject">
        ${badge}
        <span class="swal-cf-meta"><b>${escapeHtml(subject.name)}</b>${subject.detail ? `<span>${escapeHtml(subject.detail)}</span>` : ''}</span>
      </div>` : ''}
    ${opts.text ? `<p class="swal-cf-text">${escapeHtml(opts.text)}</p>` : ''}
    ${(opts.removes?.length || opts.keeps?.length) ? `<div class="swal-cf-lists">${list(opts.removes, 'removes')}${list(opts.keeps, 'keeps')}</div>` : ''}
    ${opts.typeToConfirm ? `
      <label class="swal-cf-type">
        <span>Type <b>${escapeHtml(opts.typeToConfirm)}</b> to confirm</span>
        <input id="swal-cf-type-input" autocomplete="off" spellcheck="false" />
      </label>` : ''}
  `;

  const result = await Swal.fire({
    ...BUTTON_STYLING,
    title: opts.title,
    html,
    icon: opts.danger ? 'error' : 'question',
    iconHtml: svg(opts.danger ? 'trash' : 'check', 26),
    showCancelButton: true,
    confirmButtonText: opts.confirmLabel ?? 'Confirm',
    cancelButtonText: opts.cancelLabel ?? 'Cancel',
    focusCancel: !opts.typeToConfirm,
    showClass: { popup: 'swal-signout-in' },
    customClass: {
      popup: `swal-signout swal-cf ${tone}`,
      icon: `swal-cf-icon ${tone}`,
      confirmButton: `swal-signout-btn swal-signout-confirm swal-cf-confirm ${tone}`,
      cancelButton: 'swal-signout-btn swal-signout-cancel',
      actions: 'swal-signout-actions',
    },
    didOpen: (popup) => {
      if (!opts.typeToConfirm) return;
      const input = popup.querySelector<HTMLInputElement>('#swal-cf-type-input');
      const confirm = Swal.getConfirmButton();
      const expected = opts.typeToConfirm.trim().toLowerCase();
      const sync = () => {
        const ok = (input?.value ?? '').trim().toLowerCase() === expected;
        if (confirm) confirm.disabled = !ok;
        input?.classList.toggle('ok', ok);
      };
      sync();
      input?.addEventListener('input', sync);
      input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && confirm && !confirm.disabled) confirm.click(); });
      input?.focus();
    },
  });
  return result.isConfirmed;
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

/**
 * Sign-out confirmation: title, a card naming the account being signed out,
 * then stacked full-width "Log out" / "Cancel" pills.
 */
export async function signOutDialog(account: { name: string; detail?: string | null }): Promise<boolean> {
  const initials = initialsOf(account.name);
  const result = await Swal.fire({
    ...BUTTON_STYLING,
    title: 'Log out of TokenPap?',
    html: `
      <div class="swal-signout-account">
        <span class="swal-signout-av" aria-hidden="true">${escapeHtml(initials)}</span>
        <span class="swal-signout-meta">
          <b>${escapeHtml(account.name)}</b>
          ${account.detail ? `<span>${escapeHtml(account.detail)}</span>` : ''}
        </span>
      </div>
      <p class="swal-signout-note">You'll need to log in again to access your dashboard.</p>
    `,
    showCancelButton: true,
    confirmButtonText: 'Log out',
    cancelButtonText: 'Cancel',
    focusCancel: true,
    showClass: { popup: 'swal-signout-in' },
    customClass: {
      popup: 'swal-signout',
      confirmButton: 'swal-signout-btn swal-signout-confirm',
      cancelButton: 'swal-signout-btn swal-signout-cancel',
      actions: 'swal-signout-actions',
    },
  });
  return result.isConfirmed;
}

/** Simple informational alert with a single acknowledge button. */
export function alertInfo(title: string, text?: string) {
  return Swal.fire({
    ...BUTTON_STYLING,
    title,
    text,
    icon: 'info',
    iconColor: ICON_COLOR.info,
    confirmButtonText: 'OK',
    customClass: { popup: 'swal-confirm', confirmButton: 'btn btn-primary', actions: 'swal-actions' },
  });
}

interface PromptOptions {
  title: string;
  text?: string;
  /** Small uppercase eyebrow above the title (e.g. "Out of office"). */
  kicker?: string;
  /** Optional pill shown under the lead text (e.g. a date). */
  badge?: string;
  inputLabel?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Minimum trimmed length; defaults to 1. */
  minLength?: number;
  maxLength?: number;
  validationMessage?: string;
}

/**
 * Centered modal with a short text input. Resolves the trimmed value on confirm,
 * or null if cancelled / dismissed.
 */
export async function promptDialog(opts: PromptOptions): Promise<string | null> {
  const minLength = opts.minLength ?? 1;
  const maxLength = opts.maxLength ?? 200;
  const label = opts.inputLabel ?? 'Reason';

  const result = await Swal.fire({
    ...BUTTON_STYLING,
    title: false,
    icon: undefined,
    html: `
      <div class="swal-prompt-head">
        ${opts.kicker ? `<p class="swal-prompt-kicker">${escapeHtml(opts.kicker)}</p>` : ''}
        <h2 class="swal-prompt-title">${escapeHtml(opts.title)}</h2>
        ${opts.text ? `<p class="swal-prompt-lead">${escapeHtml(opts.text)}</p>` : ''}
        ${opts.badge ? `<span class="swal-prompt-date">${escapeHtml(opts.badge)}</span>` : ''}
      </div>
      <div class="swal-prompt-body">
        <label class="swal-prompt-label" for="swal-prompt-input">${escapeHtml(label)}</label>
      </div>
    `,
    input: 'textarea',
    inputPlaceholder: opts.placeholder,
    inputAttributes: {
      id: 'swal-prompt-input',
      maxlength: String(maxLength),
      autocomplete: 'off',
      rows: '3',
    },
    showCancelButton: true,
    confirmButtonText: opts.confirmLabel ?? 'Confirm',
    cancelButtonText: opts.cancelLabel ?? 'Cancel',
    reverseButtons: true,
    focusConfirm: false,
    customClass: {
      popup: 'swal-prompt',
      htmlContainer: 'swal-prompt-html',
      input: 'swal-prompt-input',
      confirmButton: 'btn btn-primary',
      cancelButton: 'btn btn-ghost',
      actions: 'swal-actions swal-prompt-actions',
    },
    inputValidator: (value) => {
      const trimmed = value.trim();
      if (trimmed.length < minLength) {
        return opts.validationMessage ?? 'Please enter a brief reason.';
      }
      if (trimmed.length > maxLength) {
        return `Keep it under ${maxLength} characters.`;
      }
      return null;
    },
  });
  if (!result.isConfirmed || typeof result.value !== 'string') return null;
  return result.value.trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
