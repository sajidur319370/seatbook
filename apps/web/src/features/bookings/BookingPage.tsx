import { CheckCircle2, Copy, MapPin } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { formatMoney } from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { LoadError, LoadingRows } from '@/components/QueryStates';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatEventTime } from '@/lib/eventTime';
import { TicketStatusChip } from './TicketStatusChip';
import { useMyBooking } from './useBookings';

const mapsUrl = (venue: string, city: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue}, ${city}`)}`;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function NotYours({ what }: { what: string }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">{what} not found</h1>
      <Link to="/me/tickets" className="text-blue-600 hover:underline">
        Go to my tickets
      </Link>
    </div>
  );
}

/** FR-TKT-08: what the buyer sees right after paying. */
export function BookingPage() {
  const { bookingId = '' } = useParams<{ bookingId: string }>();
  const q = useMyBooking(bookingId);

  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotYours what="Booking" />;
    return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!q.data) return <LoadingRows />;
  const b = q.data.booking;

  const copyReference = () =>
    navigator.clipboard
      .writeText(b.reference)
      .then(() => toast.success('Reference copied'))
      .catch(() => toast.error("Couldn't copy. Select it instead."));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="space-y-3 p-6">
        <p className="flex items-center gap-2 font-medium text-green-700">
          <CheckCircle2 className="size-5" aria-hidden="true" /> Booking confirmed
        </p>
        <h1 className="text-2xl font-semibold wrap-anywhere">
          You’re going to <b>{b.event.title}</b>
        </h1>
        <p className="flex items-center gap-2 text-sm">
          Reference <span className="font-mono font-semibold">{b.reference}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Copy reference"
            onClick={copyReference}
          >
            <Copy />
          </Button>
        </p>
        <p className="text-gray-700">{formatEventTime(b.event.startsAt, b.event.timezone)}</p>
        <a
          href={mapsUrl(b.event.venueName, b.event.city)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <MapPin className="size-4" aria-hidden="true" />
          {b.event.venueName}, {b.event.city}
        </a>
        <p className="text-sm text-gray-600">A confirmation email is on its way.</p>
      </Card>

      <Card className="p-6">
        <h2 className="mb-2 font-semibold">Your tickets</h2>
        <ul className="divide-y">
          {b.tickets.map((t) => (
            <li key={t.id}>
              <Link
                to={`/tickets/${t.id}`}
                className="flex items-center justify-between gap-2 py-3 hover:bg-gray-50"
              >
                <span>
                  <b>{t.seatLabel}</b>
                  <span className="block text-sm text-gray-600">
                    {t.sectionName} · Row {t.row} · Seat {t.number} · {t.tierName}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-sm">
                  {formatMoney(t.price, b.currency)}
                  <TicketStatusChip ticket={t} timezone={b.event.timezone} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t pt-3 font-semibold">
          <span>Total</span>
          <span>{formatMoney(b.total, b.currency)}</span>
        </div>
        {b.payment.brand && (
          <p className="mt-1 text-sm text-gray-600">
            Paid with {capitalize(b.payment.brand)} •••• {b.payment.last4}
          </p>
        )}
      </Card>

      <Button asChild className="w-full">
        <Link to="/me/tickets">View all my tickets</Link>
      </Button>
    </div>
  );
}
