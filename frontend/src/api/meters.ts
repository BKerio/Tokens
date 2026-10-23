import api from '@/api/client';
import type {
  Customer, ListParams, LocationOption, Meter, MeterLookup, MeterStatus, PaginatedResponse, PublicTokenResult, RecordStatus,
  TokenTransaction, TokenType, TransactionStatus, TransactionsMeta, VendMode, VendResult,
} from '@/types/api';

// ── Meters ───────────────────────────────────────────────────────────────────

export interface MeterInput {
  meterNumber: string;
  type: string;
  initialReading?: number;
  status?: MeterStatus;
  vendorId?: string | null;
  landlordId?: string | null;
  sgc?: number | null;
  krn?: number | null;
  ti?: number | null;
  ea?: number | null;
  ken?: number | null;
  pricePerUnit?: number;
}

export async function listMeters(
  params: ListParams & { status?: MeterStatus; vendorId?: string; landlordId?: string; unassigned?: boolean },
): Promise<PaginatedResponse<Meter>> {
  const res = await api.get('/meters', { params });
  return { data: res.data.data, meta: res.data.meta };
}

export async function createMeter(data: MeterInput): Promise<Meter> {
  const res = await api.post('/meters', data);
  return res.data.data;
}

/** Admins edit everything, price included; vendors send only { pricePerUnit }. */
export async function updateMeter(id: string, data: Partial<MeterInput> & { pricePerUnit?: number }): Promise<Meter> {
  const res = await api.patch(`/meters/${id}`, data);
  return res.data.data;
}

export async function deleteMeter(id: string): Promise<void> {
  await api.delete(`/meters/${id}`);
}

// ── Customers ────────────────────────────────────────────────────────────────

export interface CustomerInput {
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  meterId: string;
  vendorId?: string;
  countyId?: number | null;
  constituencyId?: number | null;
  wardId?: number | null;
  status?: RecordStatus;
}

export async function listCustomers(params: ListParams & { vendorId?: string }): Promise<PaginatedResponse<Customer>> {
  const res = await api.get('/customers', { params });
  return { data: res.data.data, meta: res.data.meta };
}

export async function createCustomer(data: CustomerInput): Promise<Customer> {
  const res = await api.post('/customers', data);
  return res.data.data;
}

export async function updateCustomer(id: string, data: Partial<CustomerInput>): Promise<Customer> {
  const res = await api.patch(`/customers/${id}`, data);
  return res.data.data;
}

export async function deleteCustomer(id: string): Promise<void> {
  await api.delete(`/customers/${id}`);
}

export async function listCounties(): Promise<LocationOption[]> {
  return (await api.get('/locations/counties')).data.data;
}

export async function listConstituencies(countyId: number): Promise<LocationOption[]> {
  return (await api.get('/locations/constituencies', { params: { countyId } })).data.data;
}

export async function listWards(constituencyId: number): Promise<LocationOption[]> {
  return (await api.get('/locations/wards', { params: { constituencyId } })).data.data;
}

// ── Tokens ───────────────────────────────────────────────────────────────────

export async function meterLookup(q: string): Promise<MeterLookup[]> {
  const res = await api.get('/tokens/meter-lookup', { params: { q } });
  return res.data.data;
}

export interface GenerateTokenInput {
  meterId: string;
  tokenType: TokenType;
  vendMode?: VendMode;
  amount?: number;
  externalTransactionId?: string;
  /** ISO instant the off-system payment was made (e.g. a cash receipt's time). */
  transactionTime?: string;
  sendSms?: boolean;
  phone?: string;
  controlValue?: number;
}

export async function generateToken(data: GenerateTokenInput): Promise<VendResult> {
  const res = await api.post('/tokens/generate', data);
  return res.data.data;
}

export async function listTransactions(
  params: ListParams & { meterId?: string; status?: TransactionStatus; tokenType?: TokenType; from?: string; to?: string },
): Promise<PaginatedResponse<TokenTransaction, TransactionsMeta>> {
  const res = await api.get('/tokens/transactions', { params });
  return { data: res.data.data, meta: res.data.meta };
}

/** Public "track my token" - exact meter number or customer phone. */
export async function trackToken(q: string): Promise<PublicTokenResult[]> {
  const res = await api.get('/public/tokens/search', { params: { q } });
  return res.data.data;
}
