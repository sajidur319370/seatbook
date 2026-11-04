import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useSearchParams } from 'react-router';
import { loginSchema, type LoginInput } from '@seatbook/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';
import { safeReturnTo, useLogin } from './useAuthActions';

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const login = useLogin(returnTo);
  const { register, handleSubmit, setError, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = handleSubmit((v) =>
    login.mutateAsync(v).catch((e) => applyServerErrors(e, setError)),
  );

  return (
    <AuthCard title="Log in to SeatBook">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField id="email" label="Email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField id="password" label="Password" error={formState.errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        </FormField>
        {formState.errors.root && (
          <p className="text-sm text-red-600">{formState.errors.root.message}</p>
        )}
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to="/forgot-password" className="text-blue-600 hover:underline">
          Forgot password?
        </Link>
        <Link
          to={`/register?returnTo=${encodeURIComponent(returnTo)}`}
          className="text-blue-600 hover:underline"
        >
          Create account
        </Link>
      </div>
    </AuthCard>
  );
}
