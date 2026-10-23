import api from '@/api/client';
import type {
  ArrearsRow, BillingFrequency, LandlordAccessInfo, LandlordStaffMember, Lease, LeaseAccount, LeaseStatus, LedgerEntry, LedgerEntryType,
  PaginatedResponse, PaymentMethod, PropertyLocation, RentClaimPurpose, RentClaimStatus, RentPaymentClaim, RentReport, StaffRole, Tenant, VacantUnit,
} from '@/types/api';

/** Rent management (owner + staff): everything under /landlord. Dates are YYYY-MM-DD. */

export const getLandlordAccess = async (): Promise<LandlordAccessInfo> => (await api.get('/landlord/access')).data.data;

// ── Locations ───────────────────────────────────────────────────────────────
export const listLocations = async (): Promise<PropertyLocation[]> => (await api.get('/landlord/locations')).data.data;
export const createLocation = async (data: { name: string; county?: string; description?: string }) => (await api.post('/landlord/locations', data)).data.data;
export const updateLocation = async (id: string, data: { name?: string; county?: string; description?: string }) => (await api.patch(`/landlord/locations/${id}`, data)).data.data;
export const deleteLocation = async (id: string) => { await api.delete(`/landlord/locations/${id}`); };
export const setPropertyLocation = async (propertyId: string, locationId: string | null) => { await api.patch(`/landlord/properties/${propertyId}`, { locationId }); };

// ── Leases ──────────────────────────────────────────────────────────────────
export interface LeaseInput {
  unitId: string;
  tenantId?: string;
  tenant?: { name: string; phone: string; email?: string | null; idNumber?: string | null };
  rentAmount: number;
  depositAmount: number;
  billingFrequency: BillingFrequency;
  dueDay: number;
  startDate: string;
  endDate?: string | null;
  billFrom?: string;
  notes?: string;
  depositReceived?: { amount: number; method: PaymentMethod; reference?: string };
}

export const listTenantDirectory = async (): Promise<Tenant[]> => (await api.get('/landlord/tenants')).data.data;

export const listVacantUnits = async (propertyId?: string): Promise<VacantUnit[]> => (await api.get('/landlord/vacant-units', { params: { propertyId } })).data.data;

export async function listLeases(params: {
  page?: number; limit?: number; status?: LeaseStatus; propertyId?: string; locationId?: string; search?: string; arrearsOnly?: boolean;
}): Promise<PaginatedResponse<Lease>> {
  const res = await api.get('/landlord/leases', { params: { ...params, arrearsOnly: params.arrearsOnly ? 'true' : undefined } });
  return { data: res.data.data, meta: res.data.meta };
}
export const getLease = async (id: string): Promise<Lease> => (await api.get(`/landlord/leases/${id}`)).data.data;
export const createLease = async (data: LeaseInput): Promise<Lease> => (await api.post('/landlord/leases', data)).data.data;
export const updateLease = async (id: string, data: Partial<Pick<LeaseInput, 'rentAmount' | 'depositAmount' | 'billingFrequency' | 'dueDay' | 'endDate'>> & { notes?: string | null }): Promise<Lease> =>
  (await api.patch(`/landlord/leases/${id}`, data)).data.data;
export const terminateLease = async (id: string, data: { endDate: string; reason: string }): Promise<Lease> => (await api.post(`/landlord/leases/${id}/terminate`, data)).data.data;
export const getStatement = async (id: string): Promise<{ lease: Lease; entries: LedgerEntry[]; summary: LeaseAccount }> => (await api.get(`/landlord/leases/${id}/statement`)).data.data;

// ── Money ───────────────────────────────────────────────────────────────────
export interface MoneyInput { amount: number; date?: string; method?: PaymentMethod; reference?: string; description?: string }

export const recordPayment = async (leaseId: string, data: MoneyInput) => (await api.post(`/landlord/leases/${leaseId}/payments`, data)).data.data;
export const addCharge = async (leaseId: string, data: MoneyInput & { category?: string; dueDate?: string }) => (await api.post(`/landlord/leases/${leaseId}/charges`, data)).data.data;
export const addCredit = async (leaseId: string, data: MoneyInput) => (await api.post(`/landlord/leases/${leaseId}/credits`, data)).data.data;
export const depositAction = async (leaseId: string, data: MoneyInput & { action: 'RECEIVED' | 'REFUND' | 'APPLIED' }) => (await api.post(`/landlord/leases/${leaseId}/deposits`, data)).data.data;
export const addExpense = async (data: MoneyInput & { propertyId: string; unitId?: string; category: string }) => (await api.post('/landlord/ledger/expenses', data)).data.data;
export const reverseEntry = async (id: string, reason: string) => (await api.post(`/landlord/ledger/${id}/reverse`, { reason })).data.data;

export async function listLedger(params: {
  page?: number; limit?: number; type?: LedgerEntryType; propertyId?: string; leaseId?: string; search?: string; from?: string; to?: string;
}): Promise<PaginatedResponse<LedgerEntry>> {
  const res = await api.get('/landlord/ledger', { params });
  return { data: res.data.data, meta: res.data.meta };
}
export const listArrears = async (limit = 10): Promise<ArrearsRow[]> => (await api.get('/landlord/arrears', { params: { limit } })).data.data;

// ── Payments reported by tenants ────────────────────────────────────────────
export async function listPaymentClaims(params: { status?: RentClaimStatus; page?: number; limit?: number }): Promise<PaginatedResponse<RentPaymentClaim> & { pending: number }> {
  const res = await api.get('/landlord/payment-claims', { params });
  return { data: res.data.data, meta: res.data.meta, pending: res.data.meta.pending };
}
export const confirmPaymentClaim = async (id: string, data: { amount?: number; note?: string } = {}): Promise<RentPaymentClaim> =>
  (await api.post(`/landlord/payment-claims/${id}/confirm`, data)).data.data;
export const rejectPaymentClaim = async (id: string, reason: string): Promise<RentPaymentClaim> =>
  (await api.post(`/landlord/payment-claims/${id}/reject`, { reason })).data.data;

/** Tenant portal: "I've paid" for rent or deposit. */
export interface PaymentClaimInput { purpose: RentClaimPurpose; method: 'MPESA' | 'CASH'; amount: number; paidOn: string; reference?: string; note?: string }
export const reportPayment = async (leaseId: string, data: PaymentClaimInput): Promise<RentPaymentClaim> =>
  (await api.post(`/tenant/leases/${leaseId}/payment-claims`, data)).data.data;

// ── Reports & billing ───────────────────────────────────────────────────────
export const getRentReport = async (params: { from?: string; to?: string; groupBy?: 'property' | 'location' }): Promise<RentReport> =>
  (await api.get('/landlord/reports/summary', { params })).data.data;
export const runBilling = async (): Promise<{ leases: number; charges: number; ended: number }> => (await api.post('/landlord/billing/run')).data.data;

// ── Staff ───────────────────────────────────────────────────────────────────
export interface StaffInput {
  name: string; email: string; username: string; phone?: string; password: string;
  staffRole: StaffRole; allProperties: boolean; propertyIds: string[];
}
export const listStaff = async (): Promise<LandlordStaffMember[]> => (await api.get('/landlord/staff')).data.data;
export const createStaff = async (data: StaffInput): Promise<LandlordStaffMember> => (await api.post('/landlord/staff', data)).data.data;
export const updateStaff = async (id: string, data: Partial<Omit<StaffInput, 'email' | 'username'>> & { status?: 'ACTIVE' | 'SUSPENDED' }): Promise<LandlordStaffMember> =>
  (await api.patch(`/landlord/staff/${id}`, data)).data.data;
export const revokeStaff = async (id: string) => { await api.delete(`/landlord/staff/${id}`); };
