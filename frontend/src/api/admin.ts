import api from '@/api/client';
import type { AccountStatus, AdminStats, AuditLog, ListParams, Operator, PaginatedResponse, Role } from '@/types/api';

export async function getAdminStats(): Promise<AdminStats> {
  const res = await api.get('/admin/stats');
  return res.data.data;
}

export async function listOperators(params: ListParams & { role?: Role }): Promise<PaginatedResponse<Operator>> {
  const res = await api.get('/admin/users', { params });
  return { data: res.data.data, meta: res.data.meta };
}

export async function createOperator(data: { name: string; username: string; email: string; password: string; role: Role; phone?: string }): Promise<Operator> {
  const res = await api.post('/admin/users', data);
  return res.data.data;
}

export async function updateOperator(
  id: string,
  data: { name?: string; username?: string; email?: string; password?: string; phone?: string | null; role?: Role; status?: AccountStatus },
): Promise<Operator> {
  const res = await api.patch(`/admin/users/${id}`, data);
  return res.data.data;
}

export async function deleteOperator(id: string): Promise<void> {
  await api.delete(`/admin/users/${id}`);
}

export async function listAuditLogs(params: {
  page?: number; limit?: number; userId?: string; action?: string; subjectType?: string; from?: string; to?: string;
}): Promise<PaginatedResponse<AuditLog>> {
  const res = await api.get('/admin/audit-logs', { params });
  return { data: res.data.data, meta: res.data.meta };
}
