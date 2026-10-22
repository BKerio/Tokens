import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';

/** API base, e.g. "http://localhost:3000/api" (every backend route lives under /api). */
const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    // An expired/invalid session - but not a failed sign-in attempt, which also answers 401.
    const isAuthAttempt = String(err.config?.url ?? '').startsWith('/auth/');
    if (err.response?.status === 401 && !isAuthAttempt && useAuthStore.getState().token) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

/** Best human-readable message from an API error. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message || fallback;
}

export default client;
