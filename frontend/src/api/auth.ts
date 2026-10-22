import api from '@/api/client';
import type { CustomerProfile, StaffProfile, User } from '@/types/api';

export interface Session {
  token: string;
  user: User;
}

export async function login(identifier: string, password: string): Promise<Session> {
  const res = await api.post('/auth/login', { identifier, password });
  return res.data.data;
}

export async function sendCustomerOtp(phone: string): Promise<void> {
  await api.post('/auth/customer/send-otp', { phone });
}

export async function verifyCustomerOtp(phone: string, otp: string): Promise<Session> {
  const res = await api.post('/auth/customer/verify-otp', { phone, otp });
  return res.data.data;
}

export async function sendTenantOtp(phone: string): Promise<void> {
  await api.post('/auth/tenant/send-otp', { phone });
}

export async function verifyTenantOtp(phone: string, otp: string): Promise<Session> {
  const res = await api.post('/auth/tenant/verify-otp', { phone, otp });
  return res.data.data;
}

export async function getMe(): Promise<StaffProfile | CustomerProfile> {
  const res = await api.get('/auth/me');
  return res.data.data;
}

export async function updateMe(data: {
  name?: string; username?: string; email?: string; phone?: string | null; bio?: string | null;
  currentPassword?: string; newPassword?: string;
}): Promise<StaffProfile> {
  const res = await api.patch('/auth/me', data);
  return res.data.data;
}

export async function logoutSession(): Promise<void> {
  await api.post('/auth/logout').catch(() => undefined);
}

export async function sendResetCode(identifier: string): Promise<string> {
  const res = await api.post('/auth/forgot-password/send-otp', { identifier });
  return res.data.message;
}

export async function verifyResetCode(identifier: string, otp: string): Promise<void> {
  await api.post('/auth/forgot-password/verify-otp', { identifier, otp });
}

export async function resetPassword(identifier: string, otp: string, password: string): Promise<void> {
  await api.post('/auth/forgot-password/reset', { identifier, otp, password });
}

/** Full-page redirect to Google; the backend returns to /login#token=… */
export function googleSignInUrl(): string {
  return `${import.meta.env.VITE_API_BASE_URL}/auth/google/redirect`;
}
