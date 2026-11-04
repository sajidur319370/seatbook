import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { z } from 'zod';
import { forgotPasswordSchema } from '@seatbook/shared';
import { http } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from './AuthCard';

type ForgotInput = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, setError, formState } = useForm<ForgotInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = handleSubmit((v) =>
    http
      .post('/auth/forgot-password', v)
      .then(() => setSent(true))
      .catch((e) => applyServerErrors(e, setError)),
  );

  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <p>If that email exists, we sent a link.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="email" label="Email" error={formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </FormField>
          {formState.errors.root && (
            <p className="text-sm text-red-600">{formState.errors.root.message}</p>
          )}
          <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link to="/login" className="text-blue-600 hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
