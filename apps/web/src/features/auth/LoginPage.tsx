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
  const { register, handleSubmit, setError, setValue, formState } = useForm<LoginInput>({
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
      <DemoAccounts
        onUse={(email, password) => {
          setValue('email', email, { shouldValidate: true });
          setValue('password', password, { shouldValidate: true });
        }}
      />
    </AuthCard>
  );
}

/**
 * FR-UI-09: one demo login per role, ONLY in a build made with VITE_DEMO_ACCOUNTS=true. The
 * password is public on purpose (it's baked into the page): never reuse it anywhere else.
 */
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD as string | undefined;
const DEMO_ACCOUNTS = [
  {
    email: 'organizer@demo.seatbook.dev',
    role: 'Organizer',
    note: 'dashboards, builder, check-in',
  },
  { email: 'attendee@demo.seatbook.dev', role: 'Attendee', note: 'has tickets with QR codes' },
  { email: 'attendee2@demo.seatbook.dev', role: 'Attendee 2', note: 'a second browser' },
  { email: 'admin@demo.seatbook.dev', role: 'Admin', note: 'platform overview, approvals' },
];

function DemoAccounts({ onUse }: { onUse: (email: string, password: string) => void }) {
  if (import.meta.env.VITE_DEMO_ACCOUNTS !== 'true' || !DEMO_PASSWORD) return null;
  return (
    <section
      className="mt-6 rounded-lg border border-dashed p-3 text-sm"
      aria-label="Demo accounts"
    >
      <p className="font-medium">Demo accounts</p>
      <p className="mb-2 text-gray-600">Pick one to fill in the form, then log in.</p>
      <ul className="space-y-1">
        {DEMO_ACCOUNTS.map((a) => (
          <li key={a.email} className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <b>{a.role}</b> <span className="text-gray-600">· {a.note}</span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onUse(a.email, DEMO_PASSWORD)}
            >
              Use
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
