import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import VerifiedBadge from '@/components/shared/VerifiedBadge';
import {
  Activity,
  BookText,
  ChartColumn,
  FileSignature,
  Map,
  UserCog,
  Wallet,
  BarChart3,
  Building2,
  CircleUserRound,
  Gauge,
  Home,
  LayoutDashboard,
  Link2,
  LogOut,
  DoorOpen,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Users,
  Webhook,
  X,
  Zap,
  type LucideIcon,
  FlaskConical,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { confirmAndSignOut, homePath } from '@/lib/session';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getVendorProfile } from '@/api/accounts';
import { ROLE_LABELS, type LandlordPermission, type Role } from '@/types/api';
import logo from '@/assets/logos/tokenpap-mark.svg';
import { TAGLINE } from '@/components/brand/Logo';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Live socket link; drives the crest and avatar status dots. */
  connected: boolean;
  /** Phones: whether the slide-in drawer is open. */
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

/** `perm` hides the item from landlord staff who lack that permission (owners see everything). */
type NavItem = { label: string; path: string; Icon: LucideIcon; roles: Role[]; perm?: LandlordPermission };
type NavSection = { title?: string; items: NavItem[] };

const ADMINS: Role[] = ['SUPER_ADMIN', 'ADMIN'];
const VENDOR: Role[] = ['VENDOR'];
const LANDLORD: Role[] = ['LANDLORD'];
/** The landlord and their staff (caretakers, accountants, managers, viewers). */
const LANDLORD_ORG: Role[] = ['LANDLORD', 'LANDLORD_STAFF'];
const CUSTOMER: Role[] = ['CUSTOMER'];
const VENDING: Role[] = [...ADMINS, 'VENDOR', 'LANDLORD'];
const ALL: Role[] = [...VENDING, 'CUSTOMER', 'LANDLORD_STAFF'];

const menuSections: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard, roles: ADMINS },
      { label: 'Dashboard', path: '/vendor', Icon: LayoutDashboard, roles: VENDOR },
      { label: 'Dashboard', path: '/landlord', Icon: LayoutDashboard, roles: LANDLORD_ORG, perm: 'properties.view' },
      { label: 'Dashboard', path: '/customer', Icon: LayoutDashboard, roles: CUSTOMER },
      { label: 'Token Vending', path: '/tokens', Icon: Zap, roles: VENDING },
      { label: 'Buy Tokens', path: '/customer/buy', Icon: ShoppingCart, roles: CUSTOMER },
      { label: 'Transactions', path: '/transactions', Icon: BarChart3, roles: ADMINS },
      { label: 'Sales', path: '/transactions', Icon: BarChart3, roles: [...VENDOR, ...LANDLORD] },
      { label: 'Purchase History', path: '/transactions', Icon: Receipt, roles: CUSTOMER },
    ],
  },
  {
    title: 'Management',
    items: [
      { label: 'Vendors', path: '/vendors', Icon: Building2, roles: ADMINS },
      { label: 'Account Approvals', path: '/vendors?tab=pending', Icon: ShieldAlert, roles: ADMINS },
      { label: 'Landlords', path: '/landlords', Icon: Home, roles: ADMINS },
      { label: 'Property Units', path: '/admin/property-units', Icon: DoorOpen, roles: ADMINS },
      { label: 'Meter Management', path: '/meters', Icon: Gauge, roles: [...ADMINS, ...LANDLORD] },
      { label: 'Assigned Meters', path: '/meters/assigned', Icon: Link2, roles: ADMINS },
      { label: 'My Meters', path: '/meters', Icon: Gauge, roles: VENDOR },
      { label: 'Customers', path: '/customers', Icon: Users, roles: [...ADMINS, ...VENDOR] },
    ],
  },
  {
    title: 'Rentals',
    items: [
      { label: 'Rent Overview', path: '/landlord/rent', Icon: Wallet, roles: LANDLORD_ORG },
      { label: 'Leases', path: '/landlord/leases', Icon: FileSignature, roles: LANDLORD_ORG, perm: 'leases.view' },
      { label: 'Ledger', path: '/landlord/ledger', Icon: BookText, roles: LANDLORD_ORG, perm: 'ledger.view' },
      { label: 'Reports', path: '/landlord/reports', Icon: ChartColumn, roles: LANDLORD_ORG, perm: 'reports.view' },
    ],
  },
  {
    title: 'Properties',
    items: [
      { label: 'My Properties', path: '/landlord/properties', Icon: Home, roles: LANDLORD_ORG, perm: 'properties.view' },
      { label: 'Locations', path: '/landlord/locations', Icon: Map, roles: LANDLORD_ORG, perm: 'properties.view' },
      { label: 'Units', path: '/landlord/units', Icon: DoorOpen, roles: LANDLORD_ORG, perm: 'properties.view' },
      { label: 'Staff', path: '/landlord/staff', Icon: UserCog, roles: LANDLORD },
    ],
  },
  {
    title: 'Business',
    items: [
      { label: 'Branding', path: '/vendor/branding', Icon: Palette, roles: VENDOR },
      { label: 'SMS & Payments', path: '/vendor/settings', Icon: Smartphone, roles: VENDOR },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Vending Control', path: '/settings?tab=vending', Icon: Activity, roles: ADMINS },
      { label: 'Prism Test', path: '/admin/prism-test', Icon: FlaskConical, roles: ADMINS },
      { label: 'System Configuration', path: '/settings', Icon: SettingsIcon, roles: ADMINS },
      { label: 'Callback Settings', path: '/settings?tab=mpesa', Icon: Webhook, roles: ADMINS },
      { label: 'Roles & Permissions', path: '/admin/roles', Icon: Shield, roles: ADMINS },
      { label: 'Operators', path: '/admin/users', Icon: ShieldCheck, roles: ADMINS },
      { label: 'Audit Logs', path: '/admin/audit-logs', Icon: ScrollText, roles: ADMINS },
      { label: 'Public Enquiries', path: '/enquiries', Icon: MessageSquare, roles: ADMINS },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'My Profile', path: '/profile', Icon: CircleUserRound, roles: ALL }],
  },
];

function Sidebar({ collapsed: collapsedPref, onToggleCollapse, connected, drawerOpen, onCloseDrawer }: SidebarProps) {
  const user = useAuthStore((s) => s.user);
  const { can } = useLandlordAccess();
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  // When collapsed, hovering the rail temporarily expands it as an overlay.
  const [peek, setPeek] = useState(false);
  const [query, setQuery] = useState('');
  const isMobile = useIsMobile();
  // The drawer is always the full menu; the icon rail is a desktop-only mode.
  const collapsed = collapsedPref && !isMobile;
  const drawer = isMobile && drawerOpen;

  // Vendors brand the crest with their own logo when they've opted in (Branding page).
  const isVendor = user?.role === 'VENDOR';
  const { data: vendorProfile } = useQuery({ queryKey: ['vendor-profile'], queryFn: getVendorProfile, enabled: isVendor });
  const vendor = isVendor ? vendorProfile?.vendor : undefined;
  const crestLogo = vendor?.logoUrl && vendor.dashboardSettings?.showLogoInSidebar !== false ? vendor.logoUrl : logo;

  useEffect(() => { onCloseDrawer(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseDrawer();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer, onCloseDrawer]);
  useEffect(() => { if (!isMobile && drawerOpen) onCloseDrawer(); }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => user && item.roles.includes(user.role) && (!item.perm || user.role !== 'LANDLORD_STAFF' || can(item.perm))),
    }))
    .filter((section) => section.items.length > 0);
  const visibleItems = visibleSections.flatMap((section) => section.items);

  const q = query.trim().toLowerCase();
  const shownSections = q
    ? visibleSections
        .map((section) => ({
          ...section,
          items: section.items.filter((i) => i.label.toLowerCase().includes(q) || section.title?.toLowerCase().includes(q)),
        }))
        .filter((section) => section.items.length > 0)
    : visibleSections;

  // Paths can share a prefix, so only the longest match is marked active. A role's
  // home (e.g. /vendor) prefixes its sub-pages, so it only matches exactly. Items that
  // deep-link a tab (/settings?tab=vending) also need their query params to match.
  const home = homePath(user?.role);
  const search = new URLSearchParams(location.search);
  const activePath = visibleItems
    .map((item) => item.path)
    .filter((path) => {
      const [pathname, query] = path.split('?');
      const onPage = location.pathname === pathname || (pathname !== home && location.pathname.startsWith(`${pathname}/`));
      return onPage && [...new URLSearchParams(query)].every(([k, v]) => search.get(k) === v);
    })
    .sort((a, b) => b.length - a.length)[0];

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : user?.role?.charAt(0) ?? 'U';
  const roleLabel = user ? ROLE_LABELS[user.role] : '';

  const handleLogout = () => confirmAndSignOut(logout, navigate);

  return (
    <>
      {isMobile && (
        <div className={`sidebar-backdrop${drawer ? ' open' : ''}`} onClick={onCloseDrawer} aria-hidden="true" />
      )}
      <aside
        className={`sidebar${collapsed ? ' collapsed' : ''}${collapsed && peek ? ' peek' : ''}${drawer ? ' drawer-open' : ''}`}
        aria-hidden={isMobile && !drawer ? true : undefined}
        {...(isMobile && !drawer ? { inert: true } : {})}
        // Close as soon as a link is tapped, not when a lazy page finishes loading.
        onClickCapture={(e) => { if (drawer && (e.target as HTMLElement).closest('a')) onCloseDrawer(); }}
        onMouseEnter={() => collapsed && setPeek(true)}
        onMouseLeave={() => setPeek(false)}
      >
        <div className="sidebar-inner">
          <div className="sidebar-head">
            <div className="brand-crest">
              <div className="brand-logo">
                <img src={crestLogo} draggable={false} alt={vendor?.businessName ?? 'TokenPap'} />
              </div>
              <span
                className={`brand-crest-dot${connected ? ' on' : ''}`}
                title={connected ? 'Live' : 'Offline - reconnecting'}
                aria-hidden="true"
              />
            </div>

            <div className="brand-text">
              <span className="brand-title">{vendor?.businessName ?? 'TokenPap'}</span>
              <span className="brand-org">{vendor?.dashboardSettings?.tagline || TAGLINE}</span>
            </div>

            <button
              onClick={isMobile ? onCloseDrawer : onToggleCollapse}
              className="sidebar-collapse-btn"
              title={isMobile ? 'Close menu' : collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
              aria-label={isMobile ? 'Close menu' : collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
            >
              {isMobile ? <X size={18} /> : collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

          <div className="sidebar-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search"
              aria-label="Search the menu"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter') {
                  const first = shownSections[0]?.items[0];
                  if (first) { navigate(first.path); setQuery(''); }
                }
              }}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </div>

          <nav className="nav-scroll" aria-label="Main">
            {shownSections.length === 0 && <p className="nav-empty">No pages match “{query}”.</p>}
            {shownSections.map((section, idx) => (
              <div className="nav-group" key={section.title ?? `section-${idx}`}>
                {section.title && <div className="nav-group-label">{section.title}</div>}
                {section.items.map((item) => {
                  const isActive = item.path === activePath;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setQuery('')}
                      className={`nav-item${isActive ? ' active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      title={collapsed && !peek ? item.label : undefined}
                    >
                      <item.Icon className="nav-icon" size={24} aria-hidden="true" />
                      <span className="nav-label">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-foot">
            <Link to="/profile" className="sidebar-user" title="My profile">
              <span className="sidebar-av">
                {initials}
                <span className={`sidebar-av-dot${connected ? ' on' : ''}`} aria-hidden="true" />
              </span>
              <span className="sidebar-user-meta">
                <b className="sidebar-user-name">
                  <span>{user?.name ?? 'User'}</span>
                  {user && <VerifiedBadge size={17} />}
                </b>
                <span className="sidebar-role">{roleLabel}</span>
                {user?.email && <span className="sidebar-email">{user.email}</span>}
              </span>
            </Link>
            <button onClick={handleLogout} className="sidebar-logout-btn" title="Sign out" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
