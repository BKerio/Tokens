import { useQuery } from '@tanstack/react-query';
import { getLandlordAccess } from '@/api/rentals';
import { useAuthStore } from '@/stores/authStore';
import type { LandlordPermission } from '@/types/api';

/**
 * The signed-in landlord/staff member's role, permissions and property scope.
 * The server enforces everything; this only decides what the UI offers.
 */
export function useLandlordAccess() {
  const role = useAuthStore((s) => s.user?.role);
  const enabled = role === 'LANDLORD' || role === 'LANDLORD_STAFF';
  const { data, isLoading } = useQuery({ queryKey: ['landlord-access'], queryFn: getLandlordAccess, enabled, staleTime: 5 * 60_000 });
  const can = (p: LandlordPermission) => (role === 'LANDLORD' ? true : !!data?.permissions.includes(p));
  return { access: data, isLoading: enabled && isLoading, can, isOwner: role === 'LANDLORD' };
}
