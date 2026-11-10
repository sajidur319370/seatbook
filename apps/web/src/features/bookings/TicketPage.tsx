import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { LoadError } from '@/components/QueryStates';
import { Skeleton } from '@/components/ui/skeleton';
import { formatEventTime } from '@/lib/eventTime';
import { NotYours } from './BookingPage';
import { TicketStatusChip } from './TicketStatusChip';
import { useMyTicket } from './useBookings';

/**
 * Keeps the screen on while the ticket is open at the door. Progressive enhancement: browsers
 * without it just skip this. The browser drops the lock when the tab is hidden, so ask again when
 * it comes back.
 */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const request = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (done) void l.release();
          else lock = l;
        })
        .catch(() => {}); // low battery, or not allowed: the ticket still works
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release();
    };
  }, []);
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-2 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

/** FR-TKT-07: designed for a phone at the door. */
export function TicketPage() {
  const { ticketId = '' } = useParams<{ ticketId: string }>();
  const q = useMyTicket(ticketId);
  useWakeLock();

  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotYours what="Ticket" />;
    return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!q.data) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="aspect-square w-full" />
      </div>
    );
  }
  const { ticket, qrDataUrl, manualCode, event } = q.data;

  return (
    <div className="mx-auto max-w-sm space-y-4 text-center">
      <div>
        <h1 className="text-lg font-semibold wrap-anywhere">{ticket.eventTitle}</h1>
        <p className="text-sm text-gray-600">
          {formatEventTime(ticket.eventStartsAt, event.timezone)}
        </p>
        <p className="text-sm text-gray-600">
          {event.venueName}, {event.city}
        </p>
      </div>
      {/* White, full width, a quiet zone around it: what a door scanner needs. */}
      <div className="rounded-2xl bg-white p-4 shadow">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`QR code for seat ${ticket.seatLabel}`}
            className="mx-auto w-full max-w-[320px] [image-rendering:pixelated]"
          />
        ) : (
          <p className="py-16 font-medium text-red-700">This ticket is void.</p>
        )}
        {manualCode && (
          <p className="mt-2 font-mono text-xl tracking-widest" aria-label="Manual code">
            {manualCode}
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Info label="Section" value={ticket.sectionName} />
        <Info label="Row" value={ticket.row} />
        <Info label="Seat" value={String(ticket.number)} />
      </div>
      <p className="text-sm text-gray-700">
        {ticket.tierName} · {ticket.holderName}
      </p>
      <TicketStatusChip ticket={ticket} timezone={event.timezone} />
      {qrDataUrl && (
        <p className="text-xs text-gray-500">Turn your screen brightness up at the door.</p>
      )}
      <Link
        to={`/bookings/${ticket.bookingId}`}
        className="block text-sm text-blue-600 hover:underline"
      >
        ← Back to the booking
      </Link>
    </div>
  );
}
