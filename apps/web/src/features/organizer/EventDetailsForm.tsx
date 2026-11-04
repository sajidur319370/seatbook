import { useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock } from 'lucide-react';
import { Controller, useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import Markdown from 'react-markdown';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CURRENCIES,
  EDITABLE_AFTER_PUBLISH,
  EVENT_CATEGORIES,
  LIMITS,
  PALETTE,
  scheduleIssues,
  timezoneSchema,
  type OrganizerEventDto,
} from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { FormField } from '@/components/FormField';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { applyServerErrors } from '@/lib/formErrors';
import { SWATCH } from '@/lib/palette';
import { isoToLocalInput, localInputToIso } from '@/lib/time';
import { TimezoneCombobox } from './TimezoneCombobox';
import { useCreateEvent, useUpdateEvent } from './useOrganizerEvents';

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Required'); // "yyyy-MM-ddTHH:mm"
const optionalDateTime = localDateTime.or(z.literal('')); // empty = the default

const toDate = (value: string, tz: string) => new Date(localInputToIso(value, tz));

/** The form holds what inputs produce (strings). `toApiInput` converts on submit. */
const formSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    summary: z.string().trim().max(200),
    description: z.string().max(5000),
    category: z.enum(EVENT_CATEGORIES),
    venue: z.object({
      name: z.string().trim().min(2).max(100),
      address: z.string().trim().max(200),
      city: z.string().trim().min(2).max(60),
    }),
    timezone: timezoneSchema,
    startsAt: localDateTime,
    endsAt: localDateTime,
    salesStartAt: optionalDateTime,
    salesEndAt: optionalDateTime,
    currency: z.enum(CURRENCIES),
    maxSeatsPerOrder: z.number('Enter a number').int().min(1).max(LIMITS.maxSeatsPerOrder),
    coverColor: z.enum(PALETTE),
    refundsAllowed: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (ctx.issues.length) return;
    // The same rules as the API, so most schedule mistakes show up without a round trip.
    const issues = scheduleIssues({
      startsAt: toDate(v.startsAt, v.timezone),
      endsAt: toDate(v.endsAt, v.timezone),
      salesStartAt: v.salesStartAt ? toDate(v.salesStartAt, v.timezone) : null,
      salesEndAt: v.salesEndAt ? toDate(v.salesEndAt, v.timezone) : null,
    });
    for (const i of issues) ctx.addIssue({ code: 'custom', ...i });
  });
type FormValues = z.infer<typeof formSchema>;

export function toApiInput(v: FormValues) {
  const optional = (value: string) => (value ? localInputToIso(value, v.timezone) : null);
  return {
    ...v,
    startsAt: localInputToIso(v.startsAt, v.timezone),
    endsAt: localInputToIso(v.endsAt, v.timezone),
    salesStartAt: optional(v.salesStartAt),
    salesEndAt: optional(v.salesEndAt),
  };
}

const EDITABLE = EDITABLE_AFTER_PUBLISH as readonly string[];

/** These rules span fields, so fixing one date must re-check the others. */
const scheduleDeps: (keyof FormValues)[] = ['startsAt', 'endsAt', 'salesStartAt', 'salesEndAt'];

/** After publishing, the API refuses every other field, so they must not be sent at all (FR-EVT-02). */
function onlyEditableAfterPublish(input: ReturnType<typeof toApiInput>) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => EDITABLE.includes(key)));
}

function toFormValues(e: OrganizerEventDto): FormValues {
  return {
    title: e.title,
    summary: e.summary,
    description: e.description ?? '',
    category: e.category,
    venue: { name: e.venue.name, address: e.venue.address, city: e.venue.city },
    timezone: e.timezone,
    startsAt: isoToLocalInput(e.startsAt, e.timezone),
    endsAt: isoToLocalInput(e.endsAt, e.timezone),
    salesStartAt: e.salesStartAt ? isoToLocalInput(e.salesStartAt, e.timezone) : '',
    salesEndAt: e.salesEndAt ? isoToLocalInput(e.salesEndAt, e.timezone) : '',
    currency: e.currency,
    maxSeatsPerOrder: e.maxSeatsPerOrder,
    coverColor: e.coverColor,
    refundsAllowed: e.refundsAllowed,
  };
}

const emptyValues = (timezone: string): FormValues => ({
  title: '',
  summary: '',
  description: '',
  category: 'other',
  venue: { name: '', address: '', city: '' },
  timezone,
  startsAt: '',
  endsAt: '',
  salesStartAt: '',
  salesEndAt: '',
  currency: 'USD',
  maxSeatsPerOrder: LIMITS.defaultSeatsPerOrder,
  coverColor: 'indigo',
  refundsAllowed: false,
});

function LockHint() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="img"
          aria-label="Locked after publishing"
          className="ml-1 inline-block align-middle text-gray-500"
        >
          <Lock className="size-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Locked after publishing</TooltipContent>
    </Tooltip>
  );
}

function applyEventErrors(err: unknown, setError: UseFormSetError<FormValues>) {
  if (err instanceof ApiError && err.code === 'INVALID_SCHEDULE' && Array.isArray(err.details)) {
    for (const d of err.details as { path: string[]; message: string }[]) {
      setError(d.path.join('.') as keyof FormValues, { message: d.message });
    }
    return;
  }
  applyServerErrors(err, setError);
}

/** Pass `event` to edit, or `defaultTimezone` to create. */
export function EventDetailsForm(props: {
  event?: OrganizerEventDto;
  defaultTimezone?: string;
  onReload?: () => void;
}) {
  const { event } = props;
  const navigate = useNavigate();
  const create = useCreateEvent();
  const update = useUpdateEvent(event?.id ?? '');
  const [stale, setStale] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: event ? toFormValues(event) : emptyValues(props.defaultTimezone ?? 'UTC'),
  });
  const { errors, isSubmitting } = form.formState;

  const cancelled = event?.status === 'cancelled';
  const locked = (field: string) =>
    cancelled || (event !== undefined && event.status !== 'draft' && !EDITABLE.includes(field));
  const label = (field: string, text: ReactNode) => (
    <>
      {text}
      {locked(field) && <LockHint />}
    </>
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const input = toApiInput(values);
    try {
      if (!event) {
        const created = await create.mutateAsync(input);
        toast.success('Draft created');
        navigate(`/organizer/events/${created.id}`, { replace: true });
        return;
      }
      const body = event.status === 'draft' ? input : onlyEditableAfterPublish(input);
      await update.mutateAsync({ ...body, expectedRevision: event.revision });
      toast.success('Saved');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STALE_DRAFT') setStale(true);
      else applyEventErrors(err, form.setError);
    }
  });

  const timezone = useWatch({ control: form.control, name: 'timezone' });
  const description = useWatch({ control: form.control, name: 'description' });

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField id="title" label="Title" error={errors.title?.message}>
            <Input id="title" disabled={cancelled} {...form.register('title')} />
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <FormField id="summary" label="Summary" error={errors.summary?.message}>
            <Input id="summary" disabled={cancelled} {...form.register('summary')} />
          </FormField>
        </div>
        <FormField id="category" label="Category" error={errors.category?.message}>
          <Controller
            name="category"
            control={form.control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={cancelled}>
                <SelectTrigger id="category" className="w-full capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField
          id="currency"
          label={label('currency', 'Currency')}
          error={errors.currency?.message}
        >
          <Controller
            name="currency"
            control={form.control}
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={locked('currency')}
              >
                <SelectTrigger id="currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Venue</legend>
        <FormField
          id="venue-name"
          label={label('venue', 'Name')}
          error={errors.venue?.name?.message}
        >
          <Input id="venue-name" disabled={locked('venue')} {...form.register('venue.name')} />
        </FormField>
        <FormField
          id="venue-city"
          label={label('venue', 'City')}
          error={errors.venue?.city?.message}
        >
          <Input id="venue-city" disabled={locked('venue')} {...form.register('venue.city')} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField
            id="venue-address"
            label={label('venue', 'Address')}
            error={errors.venue?.address?.message}
          >
            <Input
              id="venue-address"
              disabled={locked('venue')}
              {...form.register('venue.address')}
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Schedule</legend>
        <div className="sm:col-span-2">
          <FormField
            id="timezone"
            label={label('timezone', 'Time zone')}
            error={errors.timezone?.message}
          >
            <Controller
              name="timezone"
              control={form.control}
              render={({ field }) => (
                <TimezoneCombobox
                  id="timezone"
                  value={field.value}
                  disabled={locked('timezone')}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>
        </div>
        <FormField
          id="startsAt"
          label={label('startsAt', `Starts (${timezone})`)}
          error={errors.startsAt?.message}
        >
          <Input
            id="startsAt"
            type="datetime-local"
            disabled={locked('startsAt')}
            {...form.register('startsAt', { deps: scheduleDeps })}
          />
        </FormField>
        <FormField
          id="endsAt"
          label={label('endsAt', `Ends (${timezone})`)}
          error={errors.endsAt?.message}
        >
          <Input
            id="endsAt"
            type="datetime-local"
            disabled={locked('endsAt')}
            {...form.register('endsAt', { deps: scheduleDeps })}
          />
        </FormField>
        <FormField
          id="salesStartAt"
          label={label('salesStartAt', `Sales start (${timezone})`)}
          error={errors.salesStartAt?.message}
        >
          <Input
            id="salesStartAt"
            type="datetime-local"
            disabled={locked('salesStartAt')}
            {...form.register('salesStartAt', { deps: scheduleDeps })}
          />
          <p className="text-xs text-gray-500">Empty: when you publish.</p>
        </FormField>
        <FormField
          id="salesEndAt"
          label={label('salesEndAt', `Sales end (${timezone})`)}
          error={errors.salesEndAt?.message}
        >
          <Input
            id="salesEndAt"
            type="datetime-local"
            disabled={locked('salesEndAt')}
            {...form.register('salesEndAt', { deps: scheduleDeps })}
          />
          <p className="text-xs text-gray-500">Empty: when the event starts.</p>
        </FormField>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="maxSeatsPerOrder"
          label={label('maxSeatsPerOrder', 'Max seats per order')}
          error={errors.maxSeatsPerOrder?.message}
        >
          <Input
            id="maxSeatsPerOrder"
            type="number"
            min={1}
            max={LIMITS.maxSeatsPerOrder}
            disabled={locked('maxSeatsPerOrder')}
            {...form.register('maxSeatsPerOrder', { valueAsNumber: true })}
          />
        </FormField>
        <FormField id="refundsAllowed" label="Allow refunds">
          <Controller
            name="refundsAllowed"
            control={form.control}
            render={({ field }) => (
              <div className="pt-1">
                <Switch
                  id="refundsAllowed"
                  checked={field.value}
                  disabled={cancelled}
                  onCheckedChange={field.onChange}
                />
              </div>
            )}
          />
        </FormField>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Cover colour</p>
        <Controller
          name="coverColor"
          control={form.control}
          render={({ field }) => (
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={cancelled}
                  aria-label={color}
                  aria-pressed={field.value === color}
                  onClick={() => field.onChange(color)}
                  className={`size-8 rounded-full ${SWATCH[color]} ${field.value === color ? 'ring-2 ring-gray-900 ring-offset-2' : ''}`}
                />
              ))}
            </div>
          )}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="description"
          label="Description (Markdown)"
          error={errors.description?.message}
        >
          <Textarea
            id="description"
            rows={8}
            disabled={cancelled}
            {...form.register('description')}
          />
        </FormField>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Preview</p>
          {/* react-markdown renders no raw HTML, so a description can't inject a script. */}
          <div className="min-h-40 space-y-2 rounded-md border bg-white p-3 text-sm [&_a]:text-blue-600 [&_a]:underline [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
            <Markdown>{description}</Markdown>
          </div>
        </div>
      </div>

      {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
      {!cancelled && (
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : event ? 'Save changes' : 'Create draft'}
        </Button>
      )}

      <AlertDialog open={stale}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This event was changed in another tab</AlertDialogTitle>
            <AlertDialogDescription>
              Reload to see the latest version. Your unsaved changes here will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setStale(false);
                props.onReload?.();
              }}
            >
              Reload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
