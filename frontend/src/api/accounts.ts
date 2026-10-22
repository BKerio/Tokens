import api from '@/api/client';
import type {
  AccountStatus, DashboardSettings, Landlord, LandlordDashboard, ListParams, Meter, MpesaConfig, PaginatedResponse, SmsConfig,
  Vendor, VendorOversight, VendorProfileResponse, VendorType,
} from '@/types/api';

// ── Vendors (admin) ──────────────────────────────────────────────────────────

export interface VendorInput {
  name: string;
  username: string;
  email: string;
  phone?: string;
  password: string;
  businessName: string;
  address?: string;
  accountId: string;
  paybill?: string;
  vendorType: VendorType;
  bankName?: string;
}

export async function listVendors(params: ListParams & { status?: AccountStatus }): Promise<PaginatedResponse<Vendor>> {
  const res = await api.get('/vendors', { params });
  return { data: res.data.data, meta: res.data.meta };
}

export async function listPendingVendors(): Promise<Vendor[]> {
  const res = await api.get('/vendors/pending');
  return res.data.data;
}

export async function createVendor(data: VendorInput): Promise<Vendor> {
  const res = await api.post('/vendors', data);
  return res.data.data;
}

export async function updateVendor(id: string, data: Partial<VendorInput> & { status?: AccountStatus }): Promise<Vendor> {
  const res = await api.patch(`/vendors/${id}`, data);
  return res.data.data;
}

export async function deleteVendor(id: string): Promise<void> {
  await api.delete(`/vendors/${id}`);
}

export async function setVendorApproval(id: string, approve: boolean): Promise<void> {
  await api.post(`/vendors/${id}/${approve ? 'approve' : 'reject'}`);
}

export async function getVendorOversight(id: string): Promise<VendorOversight> {
  const res = await api.get(`/vendors/${id}/oversight`);
  return res.data.data;
}

/** Public self-registration (pending admin approval). */
export async function registerVendor(data: Omit<VendorInput, 'businessName'> & { businessName?: string }): Promise<string> {
  const res = await api.post('/public/vendor-registrations', data);
  return res.data.message;
}

// ── Vendor self-service ──────────────────────────────────────────────────────

export async function getVendorProfile(): Promise<VendorProfileResponse> {
  const res = await api.get('/vendor/profile');
  return res.data.data;
}

export async function updateVendorProfile(data: {
  businessName?: string; address?: string | null; bankName?: string | null; dashboardSettings?: DashboardSettings;
}): Promise<Vendor> {
  const res = await api.patch('/vendor/profile', data);
  return res.data.data;
}

export async function uploadVendorLogo(dataUrl: string): Promise<{ logoUrl: string }> {
  const res = await api.post('/vendor/logo', { logo: dataUrl });
  return res.data.data;
}

export async function getVendorSmsConfig(): Promise<SmsConfig | null> {
  const res = await api.get('/vendor/sms-config');
  return res.data.data;
}

export async function updateVendorSmsConfig(data: {
  provider?: string; apiUrl?: string; apiKey?: string; partnerId?: string; shortcode?: string; enabled?: boolean;
}): Promise<SmsConfig> {
  const res = await api.put('/vendor/sms-config', data);
  return res.data.data;
}

export async function getVendorMpesaConfig(): Promise<MpesaConfig | null> {
  const res = await api.get('/vendor/mpesa-config');
  return res.data.data;
}

// ── Landlords (admin) ────────────────────────────────────────────────────────

export interface LandlordInput {
  name: string;
  email: string;
  username: string;
  password: string;
  phone: string;
  paymentAccount: string;
}

export async function listLandlords(params: ListParams): Promise<PaginatedResponse<Landlord>> {
  const res = await api.get('/landlords', { params });
  return { data: res.data.data, meta: res.data.meta };
}

export async function createLandlord(data: LandlordInput): Promise<Landlord> {
  const res = await api.post('/landlords', data);
  return res.data.data;
}

export async function updateLandlord(id: string, data: Partial<LandlordInput> & { status?: AccountStatus }): Promise<Landlord> {
  const res = await api.patch(`/landlords/${id}`, data);
  return res.data.data;
}

export async function deleteLandlord(id: string): Promise<void> {
  await api.delete(`/landlords/${id}`);
}

export async function getLandlordMeters(id: string): Promise<Meter[]> {
  const res = await api.get(`/landlords/${id}/meters`);
  return res.data.data;
}

export async function setLandlordMeters(id: string, meterIds: string[]): Promise<Meter[]> {
  const res = await api.put(`/landlords/${id}/meters`, { meterIds });
  return res.data.data;
}

// ── Landlord self-service ────────────────────────────────────────────────────

export async function getLandlordDashboard(): Promise<LandlordDashboard> {
  const res = await api.get('/landlord/dashboard');
  return res.data.data;
}
