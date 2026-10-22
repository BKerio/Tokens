import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Crown, KeyRound, Pencil, Power, ShieldCheck, Trash2, UserPlus, UserRound, Users } from 'lucide-react';
import { createOperator, deleteOperator, listOperators, updateOperator } from '@/api/admin';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify } from '@/lib/alert';
import { fmtDate } from '@/lib/datetime';
import { statusPill } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import { ChoiceTiles, FormSheet, SheetField, SheetGrid, SheetSection } from '@/components/shared/FormSheet';
import { EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput } from '@/components/shared/ui';
import { ROLE_LABELS, type Operator, type Role } from '@/types/api';

const schema = z.object({
  name: z.string().trim().min(2, 'Required'),
  username: z.string().trim().min(3, 'At least 3 characters'),
  email: z.string().trim().email('Invalid email'),
  phone: z.string().trim().optional(),
  password: z.string(),
  role: z.enum(['ADMIN', 'SUPER_ADMIN']),
});
type OperatorForm = z.infer<typeof schema>;

function OperatorModal({ operator, canGrantSuper, onClose }: { operator?: Operator; canGrantSuper: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<OperatorForm>({
    resolver: zodResolver(
      schema.refine((d) => (operator ? !d.password || d.password.length >= 8 : d.password.length >= 8), { message: 'At least 8 characters', path: ['password'] }),
    ),
    defaultValues: operator
      ? { name: operator.name, username: operator.username, email: operator.email, phone: operator.phone ?? '', password: '', role: operator.role as OperatorForm['role'] }
      : { role: 'ADMIN', password: '' },
  });

  const onSubmit = async (f: OperatorForm) => {
    try {
      if (operator) {
        await updateOperator(operator.id, { name: f.name, username: f.username, email: f.email, phone: f.phone || null, role: f.role, ...(f.password ? { password: f.password } : {}) });
      } else {
        await createOperator({ name: f.name, username: f.username, email: f.email, phone: f.phone || undefined, password: f.password, role: f.role });
      }
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      notify('success', operator ? 'Operator updated' : 'Operator created');
      onClose();
    } catch (err) {
      notify('error', 'Could not save operator', errorMessage(err));
    }
  };

  const v = watch();
  return (
    <FormSheet
      icon={ShieldCheck}
      title={operator ? `Edit ${operator.name}` : 'New operator'}
      subtitle={operator ? 'Update this operator’s details, role or password.' : 'Operators run the platform: partners, meters, settings and logs.'}
      steps={[
        { id: 'person', title: 'Person', Icon: UserRound, done: !!v.name?.trim() && !!v.email?.trim() },
        { id: 'access', title: 'Sign-in & role', Icon: KeyRound, done: !!v.username?.trim() && (!!operator || (v.password ?? '').length >= 8) },
      ]}
      width={660}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
      busy={isSubmitting}
      submitLabel={operator ? 'Save changes' : 'Create operator'}
      meta={<><ShieldCheck size={15} /> <b>{v.role === 'SUPER_ADMIN' ? 'Super admin' : 'Administrator'}</b></>}
    >
      <SheetSection id="person">
        <SheetGrid>
          <SheetField label="Full name" required error={errors.name?.message}><input className="input" autoFocus {...register('name')} /></SheetField>
          <SheetField label="Phone" aside="Optional"><input className="input" inputMode="tel" {...register('phone')} /></SheetField>
          <SheetField label="Email" required span error={errors.email?.message}><input className="input" type="email" {...register('email')} /></SheetField>
        </SheetGrid>
      </SheetSection>
      <SheetSection id="access">
        <SheetGrid>
          <SheetField label="Username" required error={errors.username?.message}><input className="input" {...register('username')} /></SheetField>
          <SheetField label={operator ? 'New password' : 'Password'} required={!operator} aside={operator ? 'Leave blank to keep' : undefined} error={errors.password?.message}>
            <input className="input" type="password" autoComplete="new-password" {...register('password')} />
          </SheetField>
        </SheetGrid>
        <div className="vf-field">
          <span className="vf-label">Role</span>
          <ChoiceTiles
            value={v.role}
            cols={2}
            label="Role"
            onChange={(r) => { if (r !== 'SUPER_ADMIN' || canGrantSuper) setValue('role', r); }}
            options={[
              { value: 'ADMIN', label: 'Administrator', hint: 'Day-to-day platform work', Icon: ShieldCheck },
              { value: 'SUPER_ADMIN', label: 'Super admin', hint: canGrantSuper ? 'Also manages operators' : 'Only super admins can grant', Icon: Crown },
            ]}
          />
        </div>
      </SheetSection>
    </FormSheet>
  );
}

function UserManagementPage() {
  const me = useAuthStore((s) => s.user);
  const isSuper = me?.role === 'SUPER_ADMIN';
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Operator | 'new' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['operators', page, search],
    queryFn: () => listOperators({ page, limit: 20, search: search || undefined }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: (o: Operator) => updateOperator(o.id, { status: o.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operators'] }),
    onError: (err) => notify('error', 'Could not update status', errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: deleteOperator,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operators'] });
      notify('success', 'Operator deleted');
    },
    onError: (err) => notify('error', 'Delete failed', errorMessage(err)),
  });

  const canManage = (o: Operator) => o.id !== me?.id && (isSuper || o.role !== ('SUPER_ADMIN' as Role));

  return (
    <div className="col" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="System"
        title="Operators"
        subtitle="TokenPap staff accounts with administrator access."
        actions={<button className="btn btn-primary" onClick={() => setEditing('new')}><UserPlus size={16} /> New operator</button>}
      />
      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--border)' }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, email, username…" />
        </div>
        {isLoading ? <LoadingBlock /> : !data?.data.length ? (
          <EmptyState icon={<Users size={28} />} title="No operators found" />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{['Name', 'Username', 'Email', 'Role', 'Status', 'Since', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {data.data.map((o) => (
                  <tr key={o.id}>
                    <td className="strong">{o.name}{o.id === me?.id && <span className="text-xs" style={{ color: 'var(--muted)' }}> (you)</span>}</td>
                    <td className="mono">{o.username}</td>
                    <td>{o.email}</td>
                    <td><span className={`pill ${o.role === 'SUPER_ADMIN' ? 'pill-gold' : 'pill-blue'}`}>{ROLE_LABELS[o.role]}</span></td>
                    <td><span className={statusPill(o.status)}>{o.status}</span></td>
                    <td>{fmtDate(o.createdAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canManage(o) && (
                        <>
                          <button className="icon-btn" title="Edit" onClick={() => setEditing(o)}><Pencil size={14} /></button>
                          <button className="icon-btn" title={o.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} onClick={() => toggle.mutate(o)}><Power size={14} /></button>
                          <button className="icon-btn" title="Delete" onClick={async () => {
                            if (await confirmDialog({ title: 'Delete operator', text: `Delete ${o.name} (${o.email})? This can't be undone.`, confirmLabel: 'Delete', danger: true })) remove.mutate(o.id);
                          }}><Trash2 size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </div>
      {editing && <OperatorModal operator={editing === 'new' ? undefined : editing} canGrantSuper={isSuper} onClose={() => setEditing(null)} />}
    </div>
  );
}

export default UserManagementPage;
