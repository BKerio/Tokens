import api from '@/api/client';
import type { PaginatedMeta } from '@/types/api';

export type CollectionStream = 'RENT' | 'ELECTRICITY' | 'WATER' | 'OTHER' | 'UNASSIGNED';
/**
 * MATCHED (token issued) · VERIFIED (rent receipt found in the M-Pesa feed) ·
 * RECORDED (rent recorded by hand) · EXCEPTION (money in, nothing issued or
 * allocated) · RESOLVED (exception settled) · PENDING · FAILED.
 */
export type CollectionStatus = 'MATCHED' | 'VERIFIED' | 'RECORDED' | 'EXCEPTION' | 'RESOLVED' | 'PENDING' | 'FAILED';

export interface CollectionRow {
  id: string;
  kind: 'TOKEN' | 'RENT';
  stream: CollectionStream;
  date: string;
  amount: number;
  channel: string;
  reference: string | null;
  payer: { name: string | null; phone: string | null };
  account: string | null;
  owner: string | null;
  place: string | null;
  status: CollectionStatus;
  reason: string | null;
  resolution: 'RENT_ALLOCATED' | 'TOKEN_ISSUED' | 'REFUNDED' | 'WRITTEN_OFF' | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  leaseId: string | null;
  suggestion: { leaseId: string; code: string; tenantName: string; unitName: string; propertyName: string } | null;
  canAllocate: boolean;
  canVend: boolean;
  canResolve: boolean;
}

export interface Tally { amount: number; count: number }

export interface CollectionSummary {
  received: Tally;
  reconciled: Tally;
  exceptions: Tally;
  manual: Tally;
  pending: Tally;
  failed: { count: number };
  matchRate: number;
  byStream: { stream: CollectionStream; amount: number; count: number }[];
  byChannel: { channel: string; amount: number; count: number }[];
  daily: ({ date: string } & Record<CollectionStream, number>)[];
}

export interface CollectionQuery {
  from: string;
  to: string;
  stream?: CollectionStream;
  status?: CollectionStatus[];
  search?: string;
  page?: number;
  limit?: number;
}

export interface LeaseOption { leaseId: string; code: string; tenantName: string; unitName: string; propertyName: string; landlordName: string; rent: number }

export async function listCollections(q: CollectionQuery): Promise<{ summary: CollectionSummary; data: CollectionRow[]; meta: PaginatedMeta }> {
  const { data } = await api.get('/collections', { params: { ...q, status: q.status?.join(',') || undefined } });
  return { summary: data.summary, data: data.data, meta: data.meta };
}

export async function searchCollectionLeases(search: string): Promise<LeaseOption[]> {
  return (await api.get('/collections/leases', { params: { search: search || undefined } })).data.data;
}

export async function allocateToRent(paymentId: string, leaseId: string, note?: string): Promise<void> {
  await api.post(`/collections/payments/${paymentId}/allocate-rent`, { leaseId, note: note || undefined });
}

export async function vendToMeter(paymentId: string, meterNumber: string): Promise<void> {
  await api.post(`/collections/payments/${paymentId}/vend`, { meterNumber });
}

export async function resolvePayment(paymentId: string, resolution: 'REFUNDED' | 'WRITTEN_OFF', note: string): Promise<void> {
  await api.post(`/collections/payments/${paymentId}/resolve`, { resolution, note });
}
