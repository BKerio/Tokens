import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Cpu, MessageSquareText, Network, Smartphone, type LucideIcon } from 'lucide-react';
import { listPaymentEntities, listSystemConfig, listVendingSettings } from '@/api/payments';
import { confirmDialog } from '@/lib/alert';
import { PageHeader } from '@/components/shared/ui';
import SmsSection from './settings/SmsSection';
import MpesaSection from './settings/MpesaSection';
import PartnerApisSection from './settings/PartnerApisSection';
import VendingSection from './settings/VendingSection';
import { configQueryKey } from './settings/useConfigForm';

type Tab = 'sms' | 'mpesa' | 'payments' | 'vending';
type Tone = 'ok' | 'warn' | 'off' | 'idle';

const TABS: { key: Tab; title: string; description: string; Icon: LucideIcon }[] = [
  { key: 'sms', title: 'SMS gateway', description: 'Token & receipt messages', Icon: MessageSquareText },
  { key: 'mpesa', title: 'M-Pesa (global)', description: 'Fallback Daraja account', Icon: Smartphone },
  { key: 'payments', title: 'Partner payment APIs', description: 'Per vendor & landlord', Icon: Network },
  { key: 'vending', title: 'STS vending', description: 'Token key data', Icon: Cpu },
];

/** One-line health for each section, shown in the side navigation. */
function useSectionStatus(): Record<Tab, { tone: Tone; label: string }> {
  const { data: sms } = useQuery({ queryKey: configQueryKey('sms'), queryFn: () => listSystemConfig('sms') });
  const { data: mpesa } = useQuery({ queryKey: configQueryKey('mpesa'), queryFn: () => listSystemConfig('mpesa') });
  const { data: entities } = useQuery({ queryKey: ['payment-entities'], queryFn: listPaymentEntities });
  const { data: vending } = useQuery({ queryKey: ['vending-settings'], queryFn: listVendingSettings });

  const cfg = (list: typeof sms, key: string) => list?.find((c) => c.key === key);
  const filled = (list: typeof sms, key: string) => { const c = cfg(list, key); return !!c && (c.isMasked || !!c.value); };

  const smsOn = cfg(sms, 'sms_enabled')?.value === 'true';
  const mpesaReady = ['mpesa_consumer_key', 'mpesa_consumer_secret', 'mpesa_passkey', 'mpesa_shortcode'].every((k) => filled(mpesa, k));
  const mpesaLive = cfg(mpesa, 'mpesa_env')?.value === 'live';
  const dedicated = [...(entities?.vendors ?? []), ...(entities?.landlords ?? [])].filter((e) => e.hasMpesaConfig).length;

  return {
    sms: sms ? (smsOn ? { tone: 'ok', label: 'Sending' } : { tone: 'off', label: 'Paused' }) : { tone: 'idle', label: '…' },
    mpesa: mpesa ? (mpesaReady ? { tone: 'ok', label: mpesaLive ? 'Live' : 'Sandbox' } : { tone: 'warn', label: 'Incomplete' }) : { tone: 'idle', label: '…' },
    payments: entities ? { tone: dedicated ? 'ok' : 'idle', label: `${dedicated} own` } : { tone: 'idle', label: '…' },
    vending: vending ? { tone: 'ok', label: 'All meters' } : { tone: 'idle', label: '…' },
  };
}

function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.key === params.get('tab')) ? (params.get('tab') as Tab) : 'sms';
  const status = useSectionStatus();
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);
  const navRef = useRef<HTMLElement>(null);

  // On narrow screens the nav is a horizontal strip; keep the active tab visible in it.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('.st-nav-item.on');
    if (nav && active && nav.scrollWidth > nav.clientWidth) {
      const a = active.getBoundingClientRect(), n = nav.getBoundingClientRect();
      nav.scrollTo({ left: nav.scrollLeft + (a.left - n.left) - (nav.clientWidth - a.width) / 2, behavior: 'smooth' });
    }
  }, [tab]);

  // Closing the tab or reloading with unsaved edits asks the browser to confirm.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const go = async (next: Tab) => {
    if (next === tab) return;
    if (dirty && !(await confirmDialog({ title: 'Leave without saving?', removes: ['Unsaved changes in this section'], confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true }))) return;
    setDirty(false);
    setParams({ tab: next });
  };

  return (
    <div className="col st-page" style={{ gap: 20 }}>
      <PageHeader eyebrow="System" title="Settings" subtitle="Gateways, payment accounts and token vending parameters." />

      <div className="st-layout">
        <nav ref={navRef} className="st-nav" aria-label="Settings sections">
          {TABS.map(({ key, title, description, Icon }) => {
            const s = status[key];
            const on = key === tab;
            return (
              <button key={key} type="button" className={`st-nav-item${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => go(key)}>
                <span className="st-nav-ico"><Icon size={18} /></span>
                <span className="st-nav-text">
                  <b>{title}</b>
                  <small>{description}</small>
                </span>
                <span className={`st-status ${s.tone}`}><i />{s.label}</span>
                <ChevronRight size={15} className="st-nav-chev" aria-hidden="true" />
              </button>
            );
          })}
        </nav>

        <div className="st-content">
          {tab === 'sms' && <SmsSection onDirtyChange={onDirtyChange} />}
          {tab === 'mpesa' && <MpesaSection onDirtyChange={onDirtyChange} />}
          {tab === 'payments' && <PartnerApisSection onDirtyChange={onDirtyChange} />}
          {tab === 'vending' && <VendingSection onDirtyChange={onDirtyChange} />}
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
