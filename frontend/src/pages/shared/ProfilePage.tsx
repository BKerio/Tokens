import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, User as UserIcon } from 'lucide-react';
import { getMe, updateMe } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { useAuthStore } from '@/stores/authStore';
import AppLoader from '@/components/shared/AppLoader';
import { Field, FormGrid, LoadingBlock, PageHeader } from '@/components/shared/ui';
import { ROLE_LABELS, type CustomerProfile, type StaffProfile } from '@/types/api';

function ProfilePage() {
  const queryClient = useQueryClient();
  const updateUser = useAuthStore((s) => s.updateUser);
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: getMe });
  const isCustomer = me?.role === 'CUSTOMER';
  const staff = !isCustomer ? (me as StaffProfile | undefined) : undefined;

  const [profile, setProfile] = useState({ name: '', username: '', email: '', phone: '', bio: '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  useEffect(() => {
    if (!me) return;
    setProfile({
      name: me.name,
      username: staff?.username ?? '',
      email: me.email ?? '',
      phone: me.phone ?? '',
      bio: staff?.bio ?? '',
    });
  }, [me, staff]);

  const saveProfile = useMutation({
    mutationFn: () =>
      updateMe(
        isCustomer
          ? { name: profile.name.trim(), email: profile.email.trim() || undefined }
          : { name: profile.name.trim(), username: profile.username.trim(), email: profile.email.trim(), phone: profile.phone.trim() || null, bio: profile.bio.trim() || null },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      updateUser({ name: profile.name.trim(), email: profile.email.trim() || null, ...(isCustomer ? {} : { username: profile.username.trim(), phone: profile.phone.trim() || null }) });
      notify('success', 'Profile updated');
    },
    onError: (err) => notify('error', 'Could not update profile', errorMessage(err)),
  });

  const changePassword = useMutation({
    mutationFn: () => updateMe({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      notify('success', 'Password changed');
    },
    onError: (err) => notify('error', 'Could not change password', errorMessage(err)),
  });

  if (isLoading || !me) return <LoadingBlock height={320} />;

  const onProfile = (e: FormEvent) => {
    e.preventDefault();
    if (profile.name.trim().length < 2) return notify('warning', 'Name must be at least 2 characters');
    saveProfile.mutate();
  };

  const onPassword = (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword.length < 8) return notify('warning', 'New password must be at least 8 characters');
    if (pw.newPassword !== pw.confirm) return notify('warning', "New passwords don't match");
    changePassword.mutate();
  };

  return (
    <div className="col" style={{ gap: 20, maxWidth: 820 }}>
      <PageHeader eyebrow="Account" title="My profile" subtitle={`${ROLE_LABELS[me.role]}${staff?.vendor ? ` · ${staff.vendor.businessName}` : staff?.landlord ? ` · ${staff.landlord.fullName}` : ''}`} />

      <form className="card" onSubmit={onProfile}>
        <div className="card-head"><span className="card-title flex items-center gap-2"><UserIcon size={15} /> Personal details</span></div>
        <div className="card-pad col" style={{ gap: 14 }}>
          <FormGrid>
            <Field label="Full name"><input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            {!isCustomer && <Field label="Username"><input className="input" value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} /></Field>}
            <Field label="Email"><input className="input" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
            {isCustomer ? (
              <Field label="Phone" hint="Contact your vendor to change the phone linked to your meter."><input className="input" value={(me as CustomerProfile).phone} disabled /></Field>
            ) : (
              <Field label="Phone"><input className="input" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field>
            )}
          </FormGrid>
          {!isCustomer && <Field label="Bio"><textarea className="eoc-textarea" rows={3} value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} /></Field>}
          <button className="btn btn-primary" type="submit" disabled={saveProfile.isPending} style={{ alignSelf: 'flex-start' }}>{saveProfile.isPending ? <AppLoader size={16} /> : 'Save profile'}</button>
        </div>
      </form>

      {!isCustomer && (
        <form className="card" onSubmit={onPassword}>
          <div className="card-head"><span className="card-title flex items-center gap-2"><KeyRound size={15} /> Change password</span></div>
          <div className="card-pad col" style={{ gap: 14 }}>
            <FormGrid>
              <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
              <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
              <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            </FormGrid>
            <button className="btn btn-primary" type="submit" disabled={changePassword.isPending} style={{ alignSelf: 'flex-start' }}>{changePassword.isPending ? <AppLoader size={16} /> : 'Change password'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default ProfilePage;
