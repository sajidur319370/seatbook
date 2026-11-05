import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import type { PublicEventDto } from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { LoadError, LoadingRows } from '@/components/QueryStates';
import { Legend } from '@/components/seatmap/Legend';
import { SeatMapViewer } from '@/components/seatmap/SeatMapViewer';
import type { RenderSeat } from '@/components/seatmap/useSeatCells';
import { EventNotFound } from '@/features/events/EventPage';
import { useEvent, useSeatMap } from '@/features/events/usePublicEvents';
import { formatEventTime } from '@/lib/eventTime';
import { CountdownBanner } from './CountdownBanner';
import { SelectionPanel } from './SelectionPanel';
import { useAddSeat, useMyHold, useReleaseAll, useRemoveSeat } from './useHold';
import { useSeatVisuals } from './useSeatVisuals';

function EventHeader({ event }: { event: PublicEventDto }) {
  return (
    <div>
      <Link to={`/e/${event.slug}`} className="text-sm text-blue-600 hover:underline">
        ← Back to the event
      </Link>
      <h1 className="text-2xl font-semibold wrap-anywhere">{event.title}</h1>
      <p className="text-sm text-gray-600">
        {formatEventTime(event.startsAt, event.timezone)} · {event.venue.name}
      </p>
    </div>
  );
}

function NotOnSale({ event }: { event: PublicEventDto }) {
  const why =
    event.phase === 'scheduled'
      ? `Tickets go on sale ${event.salesStartAt ? formatEventTime(event.salesStartAt, event.timezone) : 'soon'}.`
      : event.phase === 'cancelled'
        ? 'This event was cancelled.'
        : 'Tickets for this event are not on sale.';
  return (
    <div className="space-y-3">
      <EventHeader event={event} />
      <p className="rounded-lg bg-amber-50 p-4 text-amber-900">{why}</p>
    </div>
  );
}

export function SeatSelectionPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const eventQuery = useEvent(slug);
  const event = eventQuery.data?.event;
  const eventId = event?.id ?? '';
  const map = useSeatMap(event?.id);
  const visualOf = useSeatVisuals(eventId, map.data);
  const hold = useMyHold(eventId).data?.hold ?? null;
  const add = useAddSeat(eventId);
  const remove = useRemoveSeat(eventId);
  const releaseAll = useReleaseAll(eventId);
  const [highlightTier, setHighlightTier] = useState<number | null>(null);

  if (eventQuery.isPending) return <LoadingRows />;
  if (eventQuery.isError) {
    const { error } = eventQuery;
    if (error instanceof ApiError && error.status === 404) return <EventNotFound />;
    return <LoadError error={error} onRetry={() => eventQuery.refetch()} />;
  }
  if (!event) return <EventNotFound />;
  if (event.phase !== 'on_sale') return <NotOnSale event={event} />;
  if (map.isError) return <LoadError error={map.error} onRetry={() => map.refetch()} />;
  if (!map.data) return <LoadingRows />;

  const onSeatClick = (seat: RenderSeat) => {
    const v = visualOf(seat.id);
    if (v === 'pending') return; // ignore double clicks while in flight
    if (v === 'mine') {
      remove.mutate(seat.id);
    } else if (v === 'available') {
      if (hold && hold.seats.length >= event.maxSeatsPerOrder) {
        toast.error(`You can hold up to ${event.maxSeatsPerOrder} seats.`);
      } else {
        add.mutate(seat.id);
      }
    } else if (v === 'booked') {
      toast('That seat is sold.');
    } else if (v === 'held') {
      toast('Someone is holding that seat.');
    } else {
      toast('That seat is not for sale.');
    }
  };

  return (
    <div className="grid gap-4 pb-16 lg:grid-cols-[1fr_340px] lg:pb-0">
      <div className="min-w-0 space-y-3">
        <EventHeader event={event} />
        {/* Always the same height: the map must not jump down between one click and the next. */}
        {hold ? (
          <CountdownBanner
            eventId={event.id}
            expiresAt={hold.expiresAt}
            checkoutInProgress={hold.checkoutInProgress}
          />
        ) : (
          <p className="flex min-h-10 items-center rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-700">
            Choose a seat to hold it while you decide.
          </p>
        )}
        {/* Above the map: on a phone, a finger on the map moves the map, not the page. */}
        <Legend data={map.data} highlightTier={highlightTier} onHighlight={setHighlightTier} />
        <SeatMapViewer
          data={map.data}
          visualOf={visualOf}
          onSeatClick={onSeatClick}
          highlightTier={highlightTier}
        />
      </div>
      <SelectionPanel
        event={event}
        hold={hold}
        onRemove={(id) => remove.mutate(id)}
        onReleaseAll={(ids) => releaseAll.mutate(ids)}
      />
    </div>
  );
}
