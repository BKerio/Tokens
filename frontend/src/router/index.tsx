import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, type ReactNode } from 'react';
import RoleGuard from '@/components/shared/RoleGuard';
import AppShell from '@/components/layout/AppShell';
import LoginPage from '@/pages/auth/LoginPage';
import LandingPage from '@/pages/public/LandingPage';
import { useAuthStore } from '@/stores/authStore';
import { homePath } from '@/lib/session';
import type { Role } from '@/types/api';

// Authenticated and secondary public pages are code-split (keeps the initial
// bundle small). The Suspense boundary for in-app pages lives in AppShell.
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const TrackTokenPage = lazy(() => import('@/pages/public/TrackTokenPage'));
const BuyTokensPage = lazy(() => import('@/pages/public/BuyTokensPage'));
const LegalPage = lazy(() => import('@/pages/public/LegalPage'));
const AdminDashboard = lazy(() => import('@/pages/dashboards/AdminDashboard'));
const VendorDashboard = lazy(() => import('@/pages/dashboards/PartnerDashboards').then((m) => ({ default: m.VendorDashboard })));
const LandlordDashboard = lazy(() => import('@/pages/dashboards/PartnerDashboards').then((m) => ({ default: m.LandlordDashboard })));
const CustomerDashboard = lazy(() => import('@/pages/dashboards/CustomerDashboard'));
const CustomerBuyPage = lazy(() => import('@/pages/dashboards/CustomerDashboard').then((m) => ({ default: m.CustomerBuyPage })));
const TokensPage = lazy(() => import('@/pages/tokens/TokensPage'));
const TransactionsPage = lazy(() => import('@/pages/tokens/TransactionsPage'));
const VendorsPage = lazy(() => import('@/pages/partners/VendorsPage'));
const LandlordsPage = lazy(() => import('@/pages/partners/LandlordsPage'));
const MetersPage = lazy(() => import('@/pages/meters/MetersPage'));
const AssignedMetersPage = lazy(() => import('@/pages/meters/AssignedMetersPage'));
const CustomersPage = lazy(() => import('@/pages/meters/CustomersPage'));
const PropertiesPage = lazy(() => import('@/pages/properties/PropertiesPage'));
const UnitsPage = lazy(() => import('@/pages/properties/UnitsPage'));
const AdminPropertyUnitsPage = lazy(() => import('@/pages/properties/AdminPropertyUnitsPage'));
const RentDashboardPage = lazy(() => import('@/pages/rentals/RentDashboardPage'));
const LeasesPage = lazy(() => import('@/pages/rentals/LeasesPage'));
const LedgerPage = lazy(() => import('@/pages/rentals/LedgerPage'));
const RentReportsPage = lazy(() => import('@/pages/rentals/RentReportsPage'));
const LocationsPage = lazy(() => import('@/pages/rentals/LocationsPage'));
const StaffPage = lazy(() => import('@/pages/rentals/StaffPage'));
const BrandingPage = lazy(() => import('@/pages/vendor/VendorPages').then((m) => ({ default: m.BrandingPage })));
const VendorSettingsPage = lazy(() => import('@/pages/vendor/VendorPages').then((m) => ({ default: m.VendorSettingsPage })));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));
const EnquiriesPage = lazy(() => import('@/pages/admin/EnquiriesPage'));
const UserManagementPage = lazy(() => import('@/pages/admin/UserManagementPage'));
const AuditLogsPage = lazy(() => import('@/pages/admin/AuditLogsPage'));
const RolesPage = lazy(() => import('@/pages/admin/RolesPage'));
const ProfilePage = lazy(() => import('@/pages/shared/ProfilePage'));

const ADMINS: Role[] = ['SUPER_ADMIN', 'ADMIN'];
const VENDING: Role[] = [...ADMINS, 'VENDOR', 'LANDLORD'];
const LANDLORD_ORG: Role[] = ['LANDLORD', 'LANDLORD_STAFF'];

const Unauthorized = () => <div className="p-10 font-sans font-bold text-center" style={{ color: 'var(--red)' }}>Unauthorized Access</div>;

const guard = (allowed: Role[], page: ReactNode) => <RoleGuard allowed={allowed}>{page}</RoleGuard>;

/** Sends a signed-in user to their own home; signed-out visitors see the landing page. */
function Home() {
  const user = useAuthStore((s) => s.user);
  return user ? <Navigate to={homePath(user.role)} replace /> : <LandingPage />;
}

export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/track-token', element: <TrackTokenPage /> },
  { path: '/buy', element: <BuyTokensPage /> },
  { path: '/privacy', element: <LegalPage kind="privacy" /> },
  { path: '/terms', element: <LegalPage kind="terms" /> },
  { path: '/help', element: <LegalPage kind="help" /> },
  { path: '/unauthorized', element: <Unauthorized /> },
  {
    element: <AppShell />,
    children: [
      // Admin
      { path: 'dashboard', element: guard(ADMINS, <AdminDashboard />) },
      { path: 'vendors', element: guard(ADMINS, <VendorsPage />) },
      { path: 'landlords', element: guard(ADMINS, <LandlordsPage />) },
      { path: 'enquiries', element: guard(ADMINS, <EnquiriesPage />) },
      { path: 'settings', element: guard(ADMINS, <SettingsPage />) },
      { path: 'admin/users', element: guard(ADMINS, <UserManagementPage />) },
      { path: 'admin/audit-logs', element: guard(ADMINS, <AuditLogsPage />) },
      { path: 'admin/roles', element: guard(ADMINS, <RolesPage />) },
      { path: 'admin/property-units', element: guard(ADMINS, <AdminPropertyUnitsPage />) },
      { path: 'admin/hierarchy', element: <Navigate to="/admin/property-units" replace /> },
      { path: 'meters/assigned', element: guard(ADMINS, <AssignedMetersPage />) },
      // Shared operational pages (data is scoped server-side)
      { path: 'tokens', element: guard(VENDING, <TokensPage />) },
      { path: 'meters', element: guard(VENDING, <MetersPage />) },
      { path: 'customers', element: guard([...ADMINS, 'VENDOR'], <CustomersPage />) },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'profile', element: <ProfilePage /> },
      // Vendor
      { path: 'vendor', element: guard(['VENDOR'], <VendorDashboard />) },
      { path: 'vendor/branding', element: guard(['VENDOR'], <BrandingPage />) },
      { path: 'vendor/settings', element: guard(['VENDOR'], <VendorSettingsPage />) },
      // Landlord
      { path: 'landlord', element: guard(LANDLORD_ORG, <LandlordDashboard />) },
      { path: 'landlord/properties', element: guard(LANDLORD_ORG, <PropertiesPage />) },
      { path: 'landlord/units', element: guard(LANDLORD_ORG, <UnitsPage />) },
      { path: 'landlord/hierarchy', element: <Navigate to="/landlord/units" replace /> },
      // Rent management (owner + staff; the API enforces each staff permission)
      { path: 'landlord/rent', element: guard(LANDLORD_ORG, <RentDashboardPage />) },
      { path: 'landlord/leases', element: guard(LANDLORD_ORG, <LeasesPage />) },
      { path: 'landlord/ledger', element: guard(LANDLORD_ORG, <LedgerPage />) },
      { path: 'landlord/reports', element: guard(LANDLORD_ORG, <RentReportsPage />) },
      { path: 'landlord/locations', element: guard(LANDLORD_ORG, <LocationsPage />) },
      { path: 'landlord/staff', element: guard(['LANDLORD'], <StaffPage />) },
      // Customer
      { path: 'customer', element: guard(['CUSTOMER'], <CustomerDashboard />) },
      { path: 'customer/buy', element: guard(['CUSTOMER'], <CustomerBuyPage />) },
      { path: '*', element: <div className="p-10 font-sans font-bold text-center" style={{ color: 'var(--muted)' }}>Page Not Found</div> },
    ],
  },
]);

export default router;
