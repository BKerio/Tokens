import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Lock, Send } from 'lucide-react';
import { getVendorMpesaConfig, getVendorProfile, getVendorSmsConfig, updateVendorProfile, updateVendorSmsConfig, uploadVendorLogo } from '@/api/accounts';
import { testSms } from '@/api/payments';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { fileToDataUrl, humanize } from '@/lib/format';
import AppLoader from '@/components/shared/AppLoader';
import { Field, FormGrid, LoadingBlock, PageHeader } from '@/components/shared/ui';

export function BrandingPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ['vendor-profile'], queryFn: getVendorProfile });
  const vendor = data?.vendor;
  const [form, setForm] = useState({ businessName: '', address: '', bankName: '', tagline: '', primaryColor: '#1E3A8A', showLogoInSidebar: true });

  useEffect(() => {
    if (!vendor) return;
    setForm({
      businessName: vendor.businessName,
      address: vendor.address ?? '',
      bankName: vendor.bankName ?? '',
      tagline: vendor.dashboardSettings?.tagline ?? '',
      primaryColor: vendor.dashboardSettings?.primaryColor ?? '#1E3A8A',
      showLogoInSidebar: vendor.dashboardSettings?.showLogoInSidebar !== false,
    });
  }, [vendor]);

  const save = useMutation({
    mutationFn: () => updateVendorProfile({
      businessName: form.businessName.trim(),
      address: form.address.trim() || null,
      bankName: form.bankName.trim() || null,
      dashboardSettings: { tagline: form.tagline.trim() || null, primaryColor: form.primaryColor, showLogoInSidebar: form.showLogoInSidebar },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-profile'] });
      notify('success', 'Branding saved');
    },
    onError: (err) => notify('error', 'Could not save', errorMessage(err)),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be 2MB or smaller.');
      return uploadVendorLogo(await fileToDataUrl(file));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-profile'] });
      notify('success', 'Logo updated');
    },
    onError: (err) => notify('error', 'Upload failed', err instanceof Error && !('response' in err) ? err.message : errorMessage(err)),
  });

  if (isLoading || !vendor) return <LoadingBlock height={320} />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (form.businessName.trim().length < 2) return notify('warning', 'Business name is required');
    save.mutate();
  };

  return (
    <div className="col" style={{ gap: 20, maxWidth: 820 }}>
      <PageHeader eyebrow="Business" title="Branding" subtitle="How your business appears in your dashboard." />

      <div className="card">
        <div className="card-head"><span className="card-title">Logo</span></div>
        <div className="card-pad flex items-center gap-4 flex-wrap">
          <div style={{ width: 96, height: 96, borderRadius: 16, border: '1px dashed var(--border-strong)', display: 'grid', placeItems: 'center', overflow: 'hidden', background: 'var(--surface)' }}>
            {vendor.logoUrl ? <img src={vendor.logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <ImageUp size={28} style={{ color: 'var(--muted)' }} />}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <AppLoader size={16} /> : <><ImageUp size={15} /> {vendor.logoUrl ? 'Replace logo' : 'Upload logo'}</>}
            </button>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>PNG, JPEG, WEBP or GIF · up to 2MB</span>
          </div>
        </div>
      </div>

      <form className="card" onSubmit={onSubmit}>
        <div className="card-head"><span className="card-title">Business details</span></div>
        <div className="card-pad col" style={{ gap: 14 }}>
          <FormGrid>
            <Field label="Business name"><input className="input" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /></Field>
            <Field label="Address"><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Bank"><input className="input" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></Field>
            <Field label="Tagline"><input className="input" maxLength={255} value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Shown under your name in the sidebar" /></Field>
            <Field label="Primary colour">
              <div className="flex items-center gap-2">
                <input type="color" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} style={{ width: 44, height: 36, border: 0, background: 'transparent' }} />
                <span className="mono text-sm">{form.primaryColor}</span>
              </div>
            </Field>
          </FormGrid>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" checked={form.showLogoInSidebar} onChange={(e) => setForm({ ...form, showLogoInSidebar: e.target.checked })} /> Show my logo in the sidebar
          </label>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Account {vendor.accountId} · {humanize(vendor.vendorType)} vendor. Contact TokenPap to change your account ID or vendor type.</p>
          <button className="btn btn-primary" type="submit" disabled={save.isPending} style={{ alignSelf: 'flex-start' }}>{save.isPending ? <AppLoader size={16} /> : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

export function VendorSettingsPage() {
  const queryClient = useQueryClient();
  const { data: sms, isLoading } = useQuery({ queryKey: ['vendor-sms'], queryFn: getVendorSmsConfig });
  const { data: mpesa } = useQuery({ queryKey: ['vendor-mpesa'], queryFn: getVendorMpesaConfig });
  const [form, setForm] = useState({ provider: 'advanta', apiUrl: '', apiKey: '', partnerId: '', shortcode: '', enabled: true });
  const [test, setTest] = useState({ phone: '', message: 'Test message from TokenPap.' });

  useEffect(() => {
    if (sms) setForm({ provider: sms.provider ?? 'advanta', apiUrl: sms.apiUrl ?? '', apiKey: '', partnerId: sms.partnerId ?? '', shortcode: sms.shortcode ?? '', enabled: sms.enabled });
  }, [sms]);

  const save = useMutation({
    mutationFn: () => updateVendorSmsConfig({
      provider: form.provider || undefined, apiUrl: form.apiUrl || undefined, apiKey: form.apiKey || undefined,
      partnerId: form.partnerId || undefined, shortcode: form.shortcode || undefined, enabled: form.enabled,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-sms'] });
      notify('success', 'SMS settings saved');
    },
    onError: (err) => notify('error', 'Could not save', errorMessage(err)),
  });

  const sendTest = useMutation({
    mutationFn: () => testSms(test),
    onSuccess: (message) => notify('success', message),
    onError: (err) => notify('error', 'Test SMS failed', errorMessage(err)),
  });

  if (isLoading) return <LoadingBlock height={320} />;

  return (
    <div className="col" style={{ gap: 20, maxWidth: 820 }}>
      <PageHeader eyebrow="Business" title="SMS & payments" subtitle="Send token SMSes from your own sender ID. Leave blank to use TokenPap's gateway." />

      <form className="card" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="card-head"><span className="card-title">SMS gateway</span></div>
        <div className="card-pad col" style={{ gap: 14 }}>
          <FormGrid>
            <Field label="Provider"><input className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="advanta" /></Field>
            <Field label="API URL"><input className="input" value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} placeholder="https://quicksms.advantasms.com/api/services/sendsms/" /></Field>
            <Field label="API key" hint={sms?.apiKeySet ? 'A key is saved - leave blank to keep it.' : undefined}>
              <input className="input" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={sms?.apiKeySet ? '••••••••' : ''} />
            </Field>
            <Field label="Partner ID"><input className="input" value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })} /></Field>
            <Field label="Sender ID / shortcode"><input className="input" value={form.shortcode} onChange={(e) => setForm({ ...form, shortcode: e.target.value })} /></Field>
          </FormGrid>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Send SMS for my meters
          </label>
          <button className="btn btn-primary" type="submit" disabled={save.isPending} style={{ alignSelf: 'flex-start' }}>{save.isPending ? <AppLoader size={16} /> : 'Save SMS settings'}</button>
        </div>
      </form>

      <form className="card" onSubmit={(e) => { e.preventDefault(); if (test.phone.trim().length >= 9) sendTest.mutate(); }}>
        <div className="card-head"><span className="card-title">Send a test SMS</span></div>
        <div className="card-pad flex gap-2 flex-wrap items-end">
          <Field label="Phone"><input className="input" inputMode="tel" value={test.phone} onChange={(e) => setTest({ ...test, phone: e.target.value })} /></Field>
          <div style={{ flex: 1, minWidth: 220 }}><Field label="Message"><input className="input" value={test.message} onChange={(e) => setTest({ ...test, message: e.target.value })} /></Field></div>
          <button className="btn btn-ghost" type="submit" disabled={sendTest.isPending}>{sendTest.isPending ? <AppLoader size={16} /> : <><Send size={14} /> Send</>}</button>
        </div>
      </form>

      <div className="card">
        <div className="card-head"><span className="card-title flex items-center gap-2"><Lock size={14} /> M-Pesa (managed by TokenPap)</span></div>
        <div className="card-pad col" style={{ gap: 6 }}>
          {mpesa ? (
            <>
              <p className="text-sm" style={{ color: 'var(--ink)' }}>{humanize(mpesa.transactionType)} · shortcode <b className="mono">{mpesa.shortcode ?? '-'}</b>{mpesa.tillNo ? <> · till <b className="mono">{mpesa.tillNo}</b></> : null} · {humanize(mpesa.env)}</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Credentials {mpesa.consumerKeySet && mpesa.consumerSecretSet && mpesa.passkeySet ? 'are configured' : 'are incomplete'}.</p>
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No dedicated M-Pesa account - payments for your meters use TokenPap's default account.</p>
          )}
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Contact TokenPap support to change payment settings.</p>
        </div>
      </div>
    </div>
  );
}
