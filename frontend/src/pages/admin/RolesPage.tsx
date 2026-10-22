import { Link } from 'react-router-dom';
import { Check, Lock, Minus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/shared/ui';
import { ROLE_LABELS, type Role } from '@/types/api';

const ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'VENDOR', 'LANDLORD', 'LANDLORD_STAFF', 'TENANT', 'CUSTOMER'];

const ROLE_SUMMARY: Record<Role, string> = {
  SUPER_ADMIN: 'Full platform access, including operator accounts.',
  ADMIN: 'Runs the platform: partners, meters, settings and logs.',
  VENDOR: 'Sells tokens on their own meters to their own customers.',
  LANDLORD: 'Manages properties, units, leases, rent and the meters assigned to them.',
  LANDLORD_STAFF: "Works for one landlord as manager, caretaker, accountant or viewer, limited to assigned properties.",
  TENANT: 'Signs in by phone (once their landlord allows it) to see their lease, balance and where to pay rent.',
  CUSTOMER: 'Signs in by phone to buy tokens and see purchases.',
};

type Access = boolean | 'own' | 'view';

/** Mirrors the server-side role guards; scoped ('own') access is enforced per record by the API. */
const MATRIX: { group: string; rows: { label: string; access: Record<Role, Access> }[] }[] = [
  {
    group: 'Vending',
    rows: [
      { label: 'Generate STS tokens', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: 'own', LANDLORD: 'own', LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Buy tokens with M-Pesa', access: { SUPER_ADMIN: false, ADMIN: false, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: true, TENANT: false } },
      { label: 'View transactions', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: 'own', LANDLORD: 'own', LANDLORD_STAFF: false, CUSTOMER: 'own', TENANT: false } },
    ],
  },
  {
    group: 'Inventory',
    rows: [
      { label: 'Register, edit and delete meters', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Assign meters to vendors / landlords', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Set meter price per unit', access: { SUPER_ADMIN: false, ADMIN: false, VENDOR: 'own', LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Manage customers', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: 'own', LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Properties & units', access: { SUPER_ADMIN: 'view', ADMIN: 'view', VENDOR: false, LANDLORD: 'own', LANDLORD_STAFF: 'own', CUSTOMER: false, TENANT: false } },
    ],
  },
  {
    group: 'Rentals',
    rows: [
      { label: 'Leases, rent ledger & deposits', access: { SUPER_ADMIN: false, ADMIN: false, VENDOR: false, LANDLORD: 'own', LANDLORD_STAFF: 'own', CUSTOMER: false, TENANT: 'view' } },
      { label: 'Rent reports (property / location / portfolio)', access: { SUPER_ADMIN: false, ADMIN: false, VENDOR: false, LANDLORD: 'own', LANDLORD_STAFF: 'own', CUSTOMER: false, TENANT: false } },
      { label: 'Landlord staff accounts', access: { SUPER_ADMIN: false, ADMIN: false, VENDOR: false, LANDLORD: 'own', LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
    ],
  },
  {
    group: 'Partners',
    rows: [
      { label: 'Manage vendors & approve registrations', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Manage landlords', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Branding & SMS / payment settings', access: { SUPER_ADMIN: false, ADMIN: false, VENDOR: 'own', LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
    ],
  },
  {
    group: 'System',
    rows: [
      { label: 'Gateways, M-Pesa callback & STS vending settings', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Public enquiries', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Audit logs', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
      { label: 'Operator accounts', access: { SUPER_ADMIN: true, ADMIN: true, VENDOR: false, LANDLORD: false, LANDLORD_STAFF: false, CUSTOMER: false, TENANT: false } },
    ],
  },
];

function Cell({ access }: { access: Access }) {
  if (access === 'own') return <span className="pill pill-amber" title="Only their own records">Own</span>;
  if (access === 'view') return <span className="pill pill-gray" title="Read-only">View</span>;
  return access
    ? <Check size={16} style={{ color: 'var(--green)' }} aria-label="Allowed" />
    : <Minus size={16} style={{ color: 'var(--border-strong)' }} aria-label="Not allowed" />;
}

function RolesPage() {
  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="System"
        title="Roles & permissions"
        subtitle="TokenPap uses seven built-in roles. Permissions are enforced by the server and can't be edited here."
        actions={<Link className="btn btn-primary" to="/admin/users"><ShieldCheck size={16} /> Manage operators</Link>}
      />

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {ROLES.map((r) => (
          <div key={r} className="card card-pad col" style={{ gap: 6 }}>
            <span className="flex items-center gap-2 strong" style={{ color: 'var(--ink)' }}><Lock size={14} style={{ color: 'var(--muted)' }} /> {ROLE_LABELS[r]}</span>
            <span className="text-xs mono" style={{ color: 'var(--muted)' }}>{r}</span>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>{ROLE_SUMMARY[r]}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><span className="card-title">Permission matrix</span><span className="text-xs" style={{ color: 'var(--muted)' }}>“Own” = limited to their own meters, customers or properties · “View” = read-only</span></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Capability</th>{ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABELS[r]}</th>)}</tr></thead>
            <tbody>
              {MATRIX.map((section) => [
                <tr key={section.group}><td colSpan={ROLES.length + 1} className="eyebrow" style={{ background: 'var(--bg)' }}>{section.group}</td></tr>,
                ...section.rows.map((row) => (
                  <tr key={row.label}>
                    <td className="strong">{row.label}</td>
                    {ROLES.map((r) => <td key={r} style={{ textAlign: 'center' }}><Cell access={row.access[r]} /></td>)}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default RolesPage;
