import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, Check, Eye, EyeOff, KeyRound, Pencil, Plus, ShieldCheck, UserCog, UserRound, UserX, Wand2 } from 'lucide-react';
import { createStaff, listStaff, revokeStaff, updateStaff } from '@/api/rentals';
import { listProperties } from '@/api/properties';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { FormSheet, SheetField, SheetGrid, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/shared/ui';
import type { LandlordStaffMember, StaffRole } from '@/types/api';
import { STAFF_ROLE_INFO } from './rentUi';

function StaffModal({ member, onClose }: { member?: LandlordStaffMember; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: properties = [] } = useQuery({ queryKey: ['properties', ''], queryFn: () => listProperties() });
  const [name, setName] = useState(member?.user.name ?? '');
  const [email, setEmail] = useState(member?.user.email ?? '');
  const [username, setUsername] = useState(member?.user.username ?? '');
  const [phone, setPhone] = useState(member?.user.phone ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<StaffRole>(member?.staffRole ?? 'CARETAKER');
  const [allProperties, setAll] = useState(member?.allProperties ?? false);
  const [propertyIds, setPropertyIds] = useState<string[]>(member?.propertyIds ?? []);
  const [tried, setTried] = useState(false);

  const toggle = (id: string) => setPropertyIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const problems = {
    name: name.trim().length < 2 ? 'Enter their full name' : null,
    email: !member && !/\S+@\S+\.\S+/.test(email) ? 'Enter a valid email' : null,
    username: !member && username.trim().length < 3 ? 'At least 3 characters' : null,
    password: (!member && password.length < 8) || (member && password && password.length < 8) ? 'At least 8 characters' : null,
    access: !allProperties && propertyIds.length === 0 ? 'Choose at least one property, or give access to all' : null,
  };
  const show = (k: keyof typeof problems) => (tried ? problems[k] ?? undefined : undefined);
  const valid = !Object.values(problems).some(Boolean);

  const save = useMutation({
    mutationFn: () => member
      ? updateStaff(member.id, { name: name.trim(), phone: phone || undefined, staffRole: role, allProperties, propertyIds, ...(password ? { password } : {}) })
      : createStaff({ name: name.trim(), email: email.trim(), username: username.trim(), phone: phone || undefined, password, staffRole: role, allProperties, propertyIds }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landlord-staff'] }); notify('success', member ? 'Staff updated' : 'Staff member added', member ? undefined : `${name} can sign in as ${username}.`); onClose(); },
    onError: (err) => notify('error', 'Could not save', errorMessage(err)),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); setTried(true); if (valid) save.mutate(); };
  const generate = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    setPassword(Array.from(bytes, (b) => chars[b % chars.length]).join(''));
    setShowPw(true);
  };

  return (
    <FormSheet
      icon={UserCog}
      title={member ? `Edit ${member.user.name}` : 'Add a staff member'}
      subtitle={member ? 'Change their role, property access or password.' : 'Give someone their own sign-in to help run your properties.'}
      steps={[
        { id: 'person', title: 'Person', Icon: UserRound, done: !problems.name },
        { id: 'login', title: 'Sign-in', Icon: KeyRound, done: !problems.email && !problems.username && !problems.password },
        { id: 'role', title: 'Role', Icon: ShieldCheck, done: true },
        { id: 'access', title: 'Access', Icon: Building2, done: !problems.access },
      ]}
      width={720}
      onClose={onClose}
      onSubmit={submit}
      busy={save.isPending}
      submitLabel={member ? 'Save changes' : 'Add staff member'}
      meta={<><UserCog size={15} /> <b>{STAFF_ROLE_INFO[role].title}</b> · {allProperties ? 'all properties' : `${propertyIds.length} propert${propertyIds.length === 1 ? 'y' : 'ies'}`}</>}
    >
      <SheetSection id="person">
        <SheetGrid>
          <SheetField label="Full name" required error={show('name')}>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </SheetField>
          <SheetField label="Phone" aside="Optional">
            <input className="input" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </SheetField>
        </SheetGrid>
      </SheetSection>

      <SheetSection id="login">
        {!member && (
          <SheetGrid>
            <SheetField label="Email" required error={show('email')}>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </SheetField>
            <SheetField label="Username" required hint="They sign in with this" error={show('username')}>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} />
            </SheetField>
          </SheetGrid>
        )}
        <SheetField
          label={member ? 'New password' : 'Temporary password'}
          required={!member}
          aside={member ? 'Leave blank to keep' : undefined}
          hint="At least 8 characters. Share it privately"
          error={show('password')}
        >
          <span className="fs-pw">
            <input className="input mono" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            <button type="button" className="fs-pw-gen" onClick={generate}><Wand2 size={14} /> Generate</button>
          </span>
        </SheetField>
      </SheetSection>

      <SheetSection id="role">
        <div className="rn-roles">
          {(Object.keys(STAFF_ROLE_INFO) as StaffRole[]).map((r) => (
            <button key={r} type="button" className={`rn-role${role === r ? ' on' : ''}`} onClick={() => setRole(r)}>
              <b>{STAFF_ROLE_INFO[r].title}{role === r && <Check size={14} />}</b>
              <small>{STAFF_ROLE_INFO[r].blurb}</small>
            </button>
          ))}
        </div>
      </SheetSection>

      <SheetSection id="access">
        <label className={`fs-check${allProperties ? ' on' : ''}`}>
          <input type="checkbox" checked={allProperties} onChange={(e) => setAll(e.target.checked)} />
          <span><b>All properties</b><small>Including properties you add later.</small></span>
        </label>
        {!allProperties && (
          <div className="rn-prop-picks">
            {properties.length === 0 ? <span className="rn-muted">No properties yet.</span> : properties.map((p) => (
              <label key={p.id} className={`rn-pick${propertyIds.includes(p.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={propertyIds.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.name}{p.locationGroup && <small>{p.locationGroup.name}</small>}
              </label>
            ))}
          </div>
        )}
        {show('access') && <span className="field-error">{show('access')}</span>}
      </SheetSection>
    </FormSheet>
  );
}

/** Owner-only: people who help run the portfolio, each with a role and property scope. */
export default function StaffPage() {
  const queryClient = useQueryClient();
  const { data: staff = [], isLoading } = useQuery({ queryKey: ['landlord-staff'], queryFn: listStaff });
  const { data: properties = [] } = useQuery({ queryKey: ['properties', ''], queryFn: () => listProperties() });
  const [editing, setEditing] = useState<LandlordStaffMember | 'new' | null>(null);
  const nameOf = new Map(properties.map((p) => [p.id, p.name]));

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) => updateStaff(id, { status }),
    onSuccess: (_d, v) => { queryClient.invalidateQueries({ queryKey: ['landlord-staff'] }); notify('success', v.status === 'ACTIVE' ? 'Access restored' : 'Access suspended'); },
    onError: (err) => notify('error', 'Could not update', errorMessage(err)),
  });
  const revoke = useMutation({
    mutationFn: revokeStaff,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['landlord-staff'] }); notify('success', 'Access revoked'); },
    onError: (err) => notify('error', 'Could not revoke', errorMessage(err)),
  });

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Organization"
        title="Staff"
        subtitle="Give caretakers, accountants and managers their own sign-in, limited to their role and properties. Everything they do is in the audit log."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Add staff</button>}
      />
      <div className="card">
        {isLoading ? <LoadingBlock /> : staff.length === 0 ? (
          <EmptyState icon={<UserCog size={28} />} title="No staff yet" hint="Only you can sign in to this account right now." action={<button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Plus size={14} /> Add staff</button>} />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl rn-table">
              <thead><tr>{['Name', 'Role', 'Property access', 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {staff.map((s) => {
                  const active = s.user.status === 'ACTIVE';
                  return (
                    <tr key={s.id}>
                      <td><b className="rn-strong">{s.user.name}</b><small className="rn-sub">{s.user.username} · {s.user.email}</small></td>
                      <td><span className="pill pill-blue">{STAFF_ROLE_INFO[s.staffRole].title}</span></td>
                      <td>{s.allProperties ? 'All properties' : s.propertyIds.map((id) => nameOf.get(id) ?? 'Removed property').join(', ')}</td>
                      <td><span className={`pill ${active ? 'pill-green' : 'pill-red'}`}><span className="dot" />{active ? 'Active' : 'Suspended'}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="icon-btn" title="Edit role, access or password" onClick={() => setEditing(s)}><Pencil size={13} /></button>
                        <button className="icon-btn" title={active ? 'Suspend' : 'Restore access'} onClick={() => setStatus.mutate({ id: s.id, status: active ? 'SUSPENDED' : 'ACTIVE' })}>{active ? <Ban size={13} /> : <KeyRound size={13} />}</button>
                        <button className="icon-btn" title="Revoke" onClick={async () => { if (await confirmDialog({ title: 'Revoke access?', subject: { name: s.user.name, detail: s.user.email, icon: 'person' }, removes: ['Their sign-in, immediately'], keeps: ['Their past actions in the audit log'], confirmLabel: 'Revoke access', danger: true })) revoke.mutate(s.id); }}><UserX size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <StaffModal member={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
