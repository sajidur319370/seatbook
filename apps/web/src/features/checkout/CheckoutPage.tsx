import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Loader2 } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  formatMoney,
  type BookingDto,
  type HoldDto,
  type PaymentToken,
  type PublicEventDto,
} from '@seatbook/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { FormField } from '@/components/FormField';
import { LoadError, LoadingRows } from '@/components/QueryStates';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EventNotFound } from '@/features/events/EventPage';
import { useEvent } from '@/features/events/usePublicEvents';
import { CountdownBanner } from '@/features/seats/CountdownBanner';
import { useMyHold } from '@/features/seats/useHold';
import { formatEventTime } from '@/lib/eventTime';
import { isNetworkError, withRetry } from '@/lib/retry';
import { useEventSocket } from '@/socket/useEventSocket';
import { setPayingEvent } from './payingNow';
import { TEST_CARDS, cardSchema, tokenFor, type CardInput } from './testCards';

function TestCardsHelp({ onUse }: { onUse: (number: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="text-sm text-blue-600 hover:underline">
          Test cards
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <p className="mb-2 text-sm font-medium">Any name, a future MM/YY and any 3-digit CVC.</p>
        <ul className="space-y-1 text-sm">
          {TEST_CARDS.map((c) => (
            <li key={c.token} className="flex items-center justify-between gap-2">
              <span>
                <span className="font-mono">{c.number}</span>
                <span className="block text-xs text-gray-600">{c.result}</span>
              </span>
              <Button size="xs" variant="outline" type="button" onClick={() => onUse(c.number)}>
                Use
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function CardForm(props: {
  pending: boolean;
  total: number;
  currency: HoldDto['currency'];
  onPay: (token: PaymentToken) => void;
}) {
  const form = useForm<CardInput>({
    resolver: zodResolver(cardSchema),
    defaultValues: { name: '', number: '', expiry: '', cvc: '' },
  });
  const { errors } = form.formState;

  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <CreditCard className="size-5" aria-hidden="true" /> Payment
      </h2>
      <p className="mt-1 rounded bg-amber-50 p-2 text-sm text-amber-900">
        Test mode: use a test card. Never type a real card number here.
      </p>
      <form
        className="mt-4 space-y-4"
        noValidate
        autoComplete="off" // a mock form: don't offer to save or fill a real card
        onSubmit={form.handleSubmit((v) => props.onPay(tokenFor(v.number)!))}
      >
        <FormField id="cc-name" label="Name on card" error={errors.name?.message}>
          <Input id="cc-name" {...form.register('name')} />
        </FormField>
        <FormField
          id="cc-number"
          label={
            <span className="flex w-full items-center justify-between">
              Card number
              <TestCardsHelp onUse={(n) => form.setValue('number', n, { shouldValidate: true })} />
            </span>
          }
          error={errors.number?.message}
        >
          <Input
            id="cc-number"
            inputMode="numeric"
            placeholder="4242 4242 4242 4242"
            {...form.register('number')}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField id="cc-exp" label="Expiry" error={errors.expiry?.message}>
            <Input
              id="cc-exp"
              placeholder="MM/YY"
              inputMode="numeric"
              {...form.register('expiry')}
            />
          </FormField>
          <FormField id="cc-cvc" label="CVC" error={errors.cvc?.message}>
            <Input id="cc-cvc" inputMode="numeric" {...form.register('cvc')} />
          </FormField>
        </div>
        {/* Disabled while in flight: stops most double clicks. The Idempotency-Key stops the rest. */}
        <Button type="submit" size="lg" className="w-full" disabled={props.pending}>
          {props.pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Processing payment…
            </>
          ) : (
            `Pay ${formatMoney(props.total, props.currency)}`
          )}
        </Button>
      </form>
    </Card>
  );
}

function OrderSummary({ event, hold }: { event: PublicEventDto; hold: HoldDto }) {
  return (
    <Card className="h-fit space-y-3 p-6">
      <div>
        <h2 className="font-semibold wrap-anywhere">{event.title}</h2>
        <p className="text-sm text-gray-600">
          {formatEventTime(event.startsAt, event.timezone)} · {event.venue.name}
        </p>
      </div>
      <CountdownBanner
        eventId={event.id}
        expiresAt={hold.expiresAt}
        checkoutInProgress={hold.checkoutInProgress}
      />
      <ul className="divide-y text-sm" data-testid="order-seats">
        {hold.seats.map((s) => (
          <li key={s.id} className="flex justify-between gap-2 py-2">
            <span>
              <b>{s.label}</b>
              <span className="block text-gray-600">
                {s.section} · Row {s.row} · Seat {s.number} · {s.tierName}
              </span>
            </span>
            <span>{formatMoney(s.price, hold.currency)}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between border-t pt-2 font-semibold">
        <span>Total</span>
        <span>{formatMoney(hold.total, hold.currency)}</span>
      </div>
      <Link to={`/e/${event.slug}/seats`} className="block text-sm text-blue-600 hover:underline">
        ← Change seats
      </Link>
    </Card>
  );
}

const newKey = () => crypto.randomUUID();

export function CheckoutPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const eventQuery = useEvent(slug);
  const event = eventQuery.data?.event;
  const eventId = event?.id ?? '';
  const holdQ = useMyHold(eventId);
  useEventSocket(event?.id); // the payment window, expiry and event changes arrive here
  const hold = holdQ.data?.hold ?? null;
  // One key per ATTEMPT: created once, reused by retries, replaced after a decline (FR-PAY-11).
  // In a ref, not a plain const: a new key on every render would make a retry a new payment.
  const keyRef = useRef(newKey());

  const pay = useMutation({
    networkMode: 'always', // offline, fail now and let withRetry decide, rather than pause
    // `hold` rides along so the page can keep showing it: see `shown` below.
    mutationFn: ({ paymentToken }: { paymentToken: PaymentToken; hold: HoldDto }) => {
      const key = keyRef.current;
      let lostTrack = false; // a try may have reached the server without us hearing back
      return withRetry(
        () =>
          http.post<{ booking: BookingDto }>(
            `/events/${eventId}/hold/checkout`,
            { paymentToken },
            { headers: { 'Idempotency-Key': key } },
          ),
        {
          retryOn: (err) => {
            if (isNetworkError(err)) return (lostTrack = true);
            // Our own earlier try may still be running (a slow card): wait for it, same key.
            return lostTrack && err instanceof ApiError && err.code === 'CHECKOUT_IN_PROGRESS';
          },
        },
      );
    },
    onMutate: () => setPayingEvent(eventId),
    onSettled: () => setPayingEvent(null),
    onSuccess: ({ booking }) => {
      qc.invalidateQueries({ queryKey: qk.hold(eventId) });
      qc.invalidateQueries({ queryKey: qk.seatMap(eventId) });
      qc.invalidateQueries({ queryKey: qk.myBookings });
      qc.invalidateQueries({ queryKey: ['me', 'tickets'] });
      navigate(`/bookings/${booking.id}`, { replace: true });
    },
    onError: (err) => {
      // The server unlocked the hold but sends no message about it: fetch it again, or the
      // banner would say "Completing payment…" forever.
      qc.invalidateQueries({ queryKey: qk.hold(eventId) });
      if (!(err instanceof ApiError)) {
        toast.error("We couldn't reach the server. You won't be charged twice: try again.");
        return;
      }
      switch (err.code) {
        case 'PAYMENT_DECLINED':
          keyRef.current = newKey(); // a new attempt gets a new key
          toast.error('Your card was declined. Try another card.');
          return;
        case 'PAYMENT_PROVIDER_ERROR':
          keyRef.current = newKey();
          toast.error('The payment provider is unavailable. You were not charged.');
          return;
        case 'SEATS_LOST':
          toast.error("Some seats were released before payment finished. You weren't charged.");
          navigate(`/e/${slug}/seats`);
          return;
        case 'HOLD_EXPIRED':
        case 'NOT_FOUND':
          toast.error('Your seats were released.');
          navigate(`/e/${slug}/seats`);
          return;
        case 'TOO_MANY_ATTEMPTS':
          toast.error('Too many attempts. Please choose your seats again in a few minutes.');
          return;
        case 'CHECKOUT_IN_PROGRESS':
          toast.info('A payment for these seats is already in progress…');
          return;
        default:
          if (err.status !== 401) toast.error(err.message); // 401: the global handler logs out
      }
    },
  });

  if (eventQuery.isError) {
    const { error } = eventQuery;
    if (error instanceof ApiError && error.status === 404) return <EventNotFound />;
    return <LoadError error={error} onRetry={() => eventQuery.refetch()} />;
  }
  if (!event || holdQ.isPending) return <LoadingRows />;
  if (holdQ.isError) return <LoadError error={holdQ.error} onRetry={() => holdQ.refetch()} />;

  const paying = pay.isPending || pay.isSuccess;
  // The hold turns null the moment the booking commits (hold:changed "converted"), often before our
  // HTTP answer arrives. Keep showing what we're paying for instead of bouncing to the map.
  const shown = hold ?? (paying ? (pay.variables?.hold ?? null) : null);
  // Nothing to pay for: reloaded after the hold ran out (E6), or the countdown just hit 0 (FR-PAY-12).
  if (!shown || shown.seats.length === 0) return <Navigate to={`/e/${slug}/seats`} replace />;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <CardForm
          pending={paying}
          total={shown.total}
          currency={shown.currency}
          onPay={(paymentToken) => pay.mutate({ paymentToken, hold: shown })}
        />
        <OrderSummary event={event} hold={shown} />
      </div>
    </div>
  );
}
