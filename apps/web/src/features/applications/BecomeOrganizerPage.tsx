import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { applySchema, type ApplyInput } from '@seatbook/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { FormField } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/features/auth/useMe';
import { applyServerErrors } from '@/lib/formErrors';

function Notice(props: { title: string; text?: string; link?: string; linkText?: string }) {
  return (
    <Card className="mx-auto max-w-xl p-6 text-center">
      <h1 className="text-xl font-semibold">{props.title}</h1>
      {props.text && <p className="mt-2 text-gray-600">{props.text}</p>}
      {props.link && (
        <Link to={props.link} className="mt-3 inline-block text-blue-600 hover:underline">
          {props.linkText}
        </Link>
      )}
    </Card>
  );
}

export function BecomeOrganizerPage() {
  const me = useMe();
  const qc = useQueryClient();
  const app = me.data?.application;
  const form = useForm<ApplyInput>({ resolver: zodResolver(applySchema) });
  const apply = useMutation({
    mutationFn: (v: ApplyInput) => http.post('/organizer-applications', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });

  if (me.data?.user.role !== 'attendee') {
    return (
      <Notice title="You can already create events" link="/organizer" linkText="Go to my events" />
    );
  }
  if (app?.status === 'pending') {
    return (
      <Notice title="Application received" text="An admin will review it soon. We'll email you." />
    );
  }

  const { errors } = form.formState;
  return (
    <Card className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Sell tickets with SeatBook</h1>
      {app?.status === 'rejected' && (
        <p className="mt-2 rounded bg-red-50 p-3 text-sm text-red-800">
          Previous application rejected: {app.rejectionReason}
        </p>
      )}
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={form.handleSubmit((v) =>
          apply.mutateAsync(v).catch((e) => applyServerErrors(e, form.setError)),
        )}
      >
        <FormField id="org" label="Organization name" error={errors.organizationName?.message}>
          <Input id="org" {...form.register('organizationName')} />
        </FormField>
        <FormField id="web" label="Website (optional)" error={errors.website?.message}>
          <Input
            id="web"
            type="url"
            placeholder="https://"
            {...form.register('website', { setValueAs: (v) => v || null })}
          />
        </FormField>
        <FormField id="msg" label="What events do you run?" error={errors.message?.message}>
          <Textarea id="msg" rows={5} {...form.register('message')} />
        </FormField>
        {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Submit application
        </Button>
      </form>
    </Card>
  );
}
