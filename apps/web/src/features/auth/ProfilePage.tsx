import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  PALETTE,
  changePasswordSchema,
  updateMeSchema,
  type MeResponse,
  type PaletteColor,
  type UpdateMeInput,
  type UserDto,
} from '@seatbook/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { useLogout } from './useAuthActions';
import { useMe } from './useMe';

type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const TIME_ZONES = [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])];

function ProfileForm({ user }: { user: UserDto }) {
  const qc = useQueryClient();
  // A mutation, not a bare http call: a dead session must reach the 401 handler in queryClient.ts.
  const save = useMutation({
    mutationFn: (v: UpdateMeInput) => http.patch<{ user: UserDto }>('/me', v),
  });
  const { register, control, handleSubmit, setError, formState } = useForm<UpdateMeInput>({
    resolver: zodResolver(updateMeSchema),
    defaultValues: {
      name: user.name,
      avatarColor: user.avatarColor as PaletteColor,
      timezone: user.timezone,
    },
  });

  const onSubmit = handleSubmit((v) =>
    save
      .mutateAsync(v)
      .then(({ user: updated }) => {
        qc.setQueryData<MeResponse | null>(qk.me, (old) => old && { ...old, user: updated });
        toast.success('Profile saved');
      })
      .catch((e) => applyServerErrors(e, setError)),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField id="email" label="Email">
        <Input id="email" value={user.email} disabled />
      </FormField>
      <FormField id="name" label="Name" error={formState.errors.name?.message}>
        <Input id="name" autoComplete="name" {...register('name')} />
      </FormField>
      <FormField
        id="avatarColor"
        label="Avatar colour"
        error={formState.errors.avatarColor?.message}
      >
        <Controller
          name="avatarColor"
          control={control}
          render={({ field }) => (
            <Select name={field.name} value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="avatarColor" className="w-full capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PALETTE.map((color) => (
                  <SelectItem key={color} value={color} className="capitalize">
                    {color}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <FormField id="timezone" label="Time zone" error={formState.errors.timezone?.message}>
        <Controller
          name="timezone"
          control={control}
          render={({ field }) => (
            <Select name={field.name} value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_ZONES.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      {formState.errors.root && (
        <p className="text-sm text-red-600">{formState.errors.root.message}</p>
      )}
      <Button type="submit" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}

function PasswordForm() {
  const change = useMutation({
    mutationFn: (v: ChangePasswordInput) => http.patch('/me/password', v),
  });
  const { register, handleSubmit, setError, reset, formState } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit((v) =>
    change
      .mutateAsync(v)
      .then(() => {
        reset();
        toast.success('Password changed. Your other devices were logged out.');
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'WRONG_PASSWORD') {
          setError('currentPassword', { message: e.message });
          return;
        }
        applyServerErrors(e, setError);
      }),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormField
        id="currentPassword"
        label="Current password"
        error={formState.errors.currentPassword?.message}
      >
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          {...register('currentPassword')}
        />
      </FormField>
      <FormField
        id="newPassword"
        label="New password"
        error={formState.errors.newPassword?.message}
      >
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          {...register('newPassword')}
        />
      </FormField>
      {formState.errors.root && (
        <p className="text-sm text-red-600">{formState.errors.root.message}</p>
      )}
      <Button type="submit" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  );
}

function SessionActions() {
  const logout = useLogout();
  const logoutAll = useLogout(true);
  const busy = logout.isPending || logoutAll.isPending;

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => logout.mutate()}>
        Log out
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => logoutAll.mutate()}>
        Log out of all devices
      </Button>
    </div>
  );
}

export function ProfilePage() {
  const user = useMe().data?.user;
  if (!user) return null; // RequireAuth redirects as soon as `me` is cleared

  return (
    <main className="mx-auto max-w-xl space-y-6 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Your profile</h1>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm user={user} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <SessionActions />
        </CardContent>
      </Card>
    </main>
  );
}
