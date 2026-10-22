import api from '@/api/client';
import type { LandlordCustomer, PaymentSource, Property, PropertyDetail, PropertyType, PropertyUnit, RecordStatus, Tenant, UnitOccupancy, UnitPaymentInput } from '@/types/api';

export interface PropertyInput {
  name: string;
  propertyType: PropertyType;
  noOfUnits: number;
  location: string;
  status?: RecordStatus;
  locationId?: string | null;
  countyId?: number | null;
  constituencyId?: number | null;
  wardId?: number | null;
}

export interface UnitInput {
  name?: string;
  unitNumber?: string | null;
  status?: RecordStatus;
  monthlyRent?: number | null;
  depositAmount?: number | null;
  /** null clears the payment account; leave out to keep it. */
  payment?: UnitPaymentInput | null;
  occupancy?: UnitOccupancy;
  occupancyNote?: string | null;
  /** Replaces the tenants / customers linked to the unit. */
  tenantIds?: string[];
  customerIds?: string[];
}

export async function listProperties(search?: string): Promise<Property[]> {
  return (await api.get('/landlord/properties', { params: { search } })).data.data;
}

/** Creates the property together with its `noOfUnits` units. */
export async function createProperty(data: PropertyInput): Promise<Property> {
  return (await api.post('/landlord/properties', data)).data.data;
}

/** Changing `noOfUnits` adds units, or removes the newest never-let ones. */
export async function updateProperty(id: string, data: Partial<PropertyInput>): Promise<Property> {
  return (await api.patch(`/landlord/properties/${id}`, data)).data.data;
}

export async function deleteProperty(id: string): Promise<void> {
  await api.delete(`/landlord/properties/${id}`);
}

export async function getPropertyUnits(propertyId: string): Promise<PropertyDetail> {
  return (await api.get(`/landlord/properties/${propertyId}/units`)).data.data;
}

/** Admin oversight (read-only): any landlord's properties and their units. */
export async function listLandlordProperties(landlordId: string): Promise<Property[]> {
  return (await api.get(`/landlords/${landlordId}/properties`)).data.data;
}

export async function getLandlordPropertyUnits(landlordId: string, propertyId: string): Promise<PropertyDetail> {
  return (await api.get(`/landlords/${landlordId}/properties/${propertyId}/units`)).data.data;
}

export async function createUnit(data: UnitInput & { propertyId: string; name: string; meterId?: string | null }): Promise<PropertyUnit> {
  return (await api.post('/landlord/units', data)).data.data;
}

export async function createUnitsBulk(propertyId: string, data: { count: number; namePrefix: string; startNumber?: number }): Promise<PropertyUnit[]> {
  return (await api.post(`/landlord/properties/${propertyId}/units/bulk`, data)).data.data;
}

export async function updateUnit(id: string, data: UnitInput): Promise<PropertyUnit> {
  return (await api.patch(`/landlord/units/${id}`, data)).data.data;
}

/** Sets one payment account on every unit of a property (or only units without one). */
export async function applyPaymentAccount(propertyId: string, payment: UnitPaymentInput, onlyMissing: boolean): Promise<{ updated: number }> {
  return (await api.put(`/landlord/properties/${propertyId}/payment-account`, { payment, onlyMissing })).data.data;
}

export async function assignUnitMeter(id: string, meterId: string | null): Promise<void> {
  await api.put(`/landlord/units/${id}/meter`, { meterId });
}

export async function deleteUnit(id: string): Promise<void> {
  await api.delete(`/landlord/units/${id}`);
}

export async function createTenant(data: {
  propertyId: string; name: string; phone: string; email?: string | null; idNumber?: string | null; unitId?: string | null; status?: RecordStatus;
}): Promise<Tenant> {
  return (await api.post('/landlord/tenants', data)).data.data;
}

export async function updateTenant(id: string, data: { name?: string; phone?: string; email?: string | null; idNumber?: string | null; propertyId?: string; unitId?: string | null; status?: RecordStatus }): Promise<Tenant> {
  return (await api.patch(`/landlord/tenants/${id}`, data)).data.data;
}

export async function deleteTenant(id: string): Promise<void> {
  await api.delete(`/landlord/tenants/${id}`);
}

// ── People: tenants & customers ─────────────────────────────────────────────

export async function listTenants(): Promise<Tenant[]> {
  return (await api.get('/landlord/tenants')).data.data;
}

export async function listLandlordCustomers(): Promise<LandlordCustomer[]> {
  return (await api.get('/landlord/customers')).data.data;
}

export interface LandlordCustomerInput {
  name: string;
  phone: string;
  email?: string | null;
  unitId?: string | null;
  status?: RecordStatus;
}

/** Linking a unit means the customer buys tokens for that unit's meter. */
export async function createLandlordCustomer(data: LandlordCustomerInput): Promise<LandlordCustomer> {
  return (await api.post('/landlord/customers', data)).data.data;
}

export async function updateLandlordCustomer(id: string, data: Partial<LandlordCustomerInput>): Promise<LandlordCustomer> {
  return (await api.patch(`/landlord/customers/${id}`, data)).data.data;
}

export async function deleteLandlordCustomer(id: string): Promise<void> {
  await api.delete(`/landlord/customers/${id}`);
}

/** Payment accounts configured for this landlord (theirs + TokenPap's) that units can use. */
export async function listPaymentSources(): Promise<PaymentSource[]> {
  return (await api.get('/landlord/payment-sources')).data.data;
}
