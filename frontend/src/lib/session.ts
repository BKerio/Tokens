import { notify, signOutDialog } from '@/lib/alert';
import { logoutSession } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import type { Role } from '@/types/api';

/** Where each role lands after signing in. */
export function homePath(role: Role | undefined | null): string {
  switch (role) {
    case 'VENDOR': return '/vendor';
    case 'LANDLORD': return '/landlord';
    case 'LANDLORD_STAFF': return '/landlord/rent';
    case 'CUSTOMER': return '/customer';
    case 'TENANT': return '/tenant';
    default: return '/dashboard';
  }
}

export async function confirmAndSignOut(
  logout: () => void,
  navigate: (path: string) => void,
): Promise<void> {
  const user = useAuthStore.getState().user;
  const confirmed = await signOutDialog({
    name: user?.name ?? 'Your account',
    detail: user?.email ?? user?.phone ?? user?.username,
  });
  if (!confirmed) return;

  await logoutSession();
  notify('success', 'Signed out', "You've been signed out.");
  logout();
  navigate('/login');
}
