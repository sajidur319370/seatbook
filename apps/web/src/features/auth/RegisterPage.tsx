import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useSearchParams } from 'react-router';
import { registerSchema, type RegisterInput } from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';
import { safeReturnTo, useRegister } from './useAuthActions';

export function RegisterPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const signUp = useRegister(returnTo);
  const { register, handleSubmit, setError, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = handleSubmit((v) =>
    signUp.mutateAsync(v).catch((e) => {
      if (e instanceof ApiError && e.code === 'EMAIL_TAKEN') {
        setError('email', { message: e.message });
        return;
      }
      applyServerErrors(e, setError);
    }),
  );

  return (
    <AuthCard title="Create your account">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="name" label="Name" error={formState.errors.name?.message}>
          <Input id="name" autoComplete="name" {...register('name')} />
        </FormField>
        <FormField id="email" label="Email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField id="password" label="Password" error={formState.errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
        </FormField>
        {formState.errors.root && (
          <p className="text-sm text-red-600">{formState.errors.root.message}</p>
        )}
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{' '}
        <Link
          to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
          className="text-blue-600 hover:underline"
        >
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
