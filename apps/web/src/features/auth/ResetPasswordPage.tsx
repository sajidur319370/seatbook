import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { resetPasswordSchema } from '@seatbook/shared';
import { http, setAccessToken } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';

type ResetInput = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, setError, formState } = useForm<ResetInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '' },
  });

  const onSubmit = handleSubmit((v) =>
    http
      .post('/auth/reset-password', v)
      .then(() => {
        // The server revoked every session, including this browser's, so forget it here too.
        setAccessToken(null);
        qc.clear();
        qc.setQueryData(qk.me, null);
        toast.success('Password changed');
        navigate('/login', { replace: true });
      })
      .catch((e) => applyServerErrors(e, setError)),
  );

  // `token` comes from the URL, not an input, so a malformed link would otherwise fail silently.
  const formError = formState.errors.token
    ? 'This reset link is invalid or has expired.'
    : formState.errors.root?.message;

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="password" label="New password" error={formState.errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
        </FormField>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Saving…' : 'Change password'}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link to="/forgot-password" className="text-blue-600 hover:underline">
          Request a new link
        </Link>
      </p>
    </AuthCard>
  );
}
