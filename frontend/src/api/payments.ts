import api from '@/api/client';
import type {
  EnquiryStatus, Enquiry, ListParams, MpesaConfig, MpesaEnv, MpesaTransactionType, PaginatedResponse, Payment, PaymentChannel,
  PaymentEntity, PaymentStatus, PaymentStatusResult, StkPushResult, SystemConfig, VendingSetting,
} from '@/types/api';

// ── M-Pesa (public) ──────────────────────────────────────────────────────────

export async function stkPush(data: { phone: string; amount: number; reference: string }): Promise<StkPushResult> {
  const res = await api.post('/mpesa/stkpush', data);
  return res.data.data;
}

/** Long-polls (~25s server side) for the STK callback and the vended tokens. */
export async function waitForPayment(checkoutRequestId: string): Promise<PaymentStatusResult> {
  const res = await api.get(`/mpesa/query/${encodeURIComponent(checkoutRequestId)}`, { params: { wait: 1 }, timeout: 40_000 });
  return res.data.data;
}

export async function listPayments(
  params: ListParams & { status?: PaymentStatus; channel?: PaymentChannel; from?: string; to?: string },
): Promise<PaginatedResponse<Payment>> {
  const res = await api.get('/payments', { params });
  return { data: res.data.data, meta: res.data.meta };
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function listSystemConfig(category?: string): Promise<SystemConfig[]> {
  const res = await api.get('/settings/system-config', { params: { category } });
  return res.data.data;
}

export async function bulkUpdateSystemConfig(configs: { key: string; value: string }[]): Promise<string[]> {
  const res = await api.post('/settings/system-config/bulk-update', { configs });
  return res.data.data.updated;
}

export async function listVendingSettings(): Promise<VendingSetting[]> {
  return (await api.get('/settings/vending')).data.data;
}

export async function updateVendingSettings(settings: { key: string; value: string | null; isActive?: boolean }[]): Promise<VendingSetting[]> {
  return (await api.put('/settings/vending', { settings })).data.data;
}

export async function listPaymentEntities(): Promise<{ vendors: PaymentEntity[]; landlords: PaymentEntity[] }> {
  return (await api.get('/settings/payment-config/entities')).data.data;
}

export async function getEntityMpesaConfig(type: 'vendor' | 'landlord', id: string): Promise<{ owner: { id: string; name: string; email: string }; mpesaConfig: MpesaConfig | null }> {
  return (await api.get(`/settings/payment-config/${type}s/${id}`)).data.data;
}

export interface MpesaConfigInput {
  consumerKey?: string;
  consumerSecret?: string;
  passkey?: string;
  shortcode?: string;
  tillNo?: string;
  env?: MpesaEnv;
  transactionType?: MpesaTransactionType;
  callbackUrl?: string;
}

export async function saveEntityMpesaConfig(type: 'vendor' | 'landlord', id: string, data: MpesaConfigInput): Promise<MpesaConfig> {
  return (await api.put(`/settings/payment-config/${type}s/${id}`, data)).data.data;
}

export async function testSms(data: { phone: string; message: string; vendorId?: string }): Promise<string> {
  return (await api.post('/settings/test-sms', data)).data.message;
}

export async function testMpesa(data: { phone: string; amount: number; vendorId?: string; landlordId?: string }): Promise<string> {
  return (await api.post('/settings/test-mpesa', data)).data.message;
}

// ── Enquiries ────────────────────────────────────────────────────────────────

export async function submitEnquiry(data: Omit<Enquiry, 'id' | 'status' | 'createdAt'>): Promise<void> {
  await api.post('/public/enquiries', data);
}

export async function listEnquiries(params: ListParams & { status?: EnquiryStatus }): Promise<PaginatedResponse<Enquiry>> {
  const res = await api.get('/enquiries', { params });
  return { data: res.data.data, meta: res.data.meta };
}

export async function updateEnquiryStatus(id: string, status: EnquiryStatus): Promise<Enquiry> {
  return (await api.patch(`/enquiries/${id}`, { status })).data.data;
}

export async function deleteEnquiry(id: string): Promise<void> {
  await api.delete(`/enquiries/${id}`);
}
