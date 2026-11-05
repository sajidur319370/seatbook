import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatMoney, type PublicEventDto, type SeatMapResponse } from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { MarkdownView } from '@/components/MarkdownView';
import { LoadError, LoadingRows } from '@/components/QueryStates';
import { Legend } from '@/components/seatmap/Legend';
import type { SeatVisual } from '@/components/seatmap/Seat';
import { SeatMapViewer } from '@/components/seatmap/SeatMapViewer';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMe } from '@/features/auth/useMe';
import { PhaseBadge } from '@/components/PhaseBadge';
import { formatEventTime, viewerTimeIfDifferent } from '@/lib/eventTime';
import { SWATCH } from '@/lib/palette';
import { useEvent, useSeatMap } from './usePublicEvents';

/** Read-only for now: each seat just shows its status. Day 13 adds "mine" and "pending". */
export function useStatusVisuals(data: SeatMapResponse | undefined) {
  const statusById = useMemo(
    () => new Map(data?.seats.map((c) => [c.id, c.st]) ?? []),
    [data?.seats],
  );
  return useCallback((id: string): SeatVisual => statusById.get(id) ?? 'blocked', [statusById]);
}

export function EventNotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Event not found</h1>
      <p className="mt-1 text-gray-600">It may have been removed, or the link may be wrong.</p>
      <Link to="/" className="text-blue-600 hover:underline">
        Browse upcoming events
      </Link>
    </div>
  );
}

function EventTime({ event }: { event: PublicEventDto }) {
  const time = formatEventTime(event.startsAt, event.timezone);
  const yours = viewerTimeIfDifferent(event.startsAt, event.timezone);
  if (!yours) return <p data-testid="event-time">{time}</p>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p
          data-testid="event-time"
          tabIndex={0}
          className="w-fit cursor-help underline decoration-dotted"
        >
          {time}
        </p>
      </TooltipTrigger>
      <TooltipContent>Your time: {yours}</TooltipContent>
    </Tooltip>
  );
}

function CallToAction({ event }: { event: PublicEventDto }) {
  switch (event.phase) {
    case 'on_sale':
      return event.soldOut ? (
        <Button disabled>Sold out</Button>
      ) : (
        <Button asChild>
          <Link to={`/e/${event.slug}/seats`}>Choose seats</Link>
        </Button>
      );
    case 'scheduled':
      return (
        <Button disabled>
          On sale {event.salesStartAt && formatEventTime(event.salesStartAt, event.timezone)}
        </Button>
      );
    case 'sales_closed':
    case 'ended':
      return <Button disabled>Sales closed</Button>;
    default:
      return null;
  }
}

function TierList({ event }: { event: PublicEventDto }) {
  return (
    <ul className="divide-y rounded-lg border bg-white">
      {event.tiers?.map((t) => {
        const left = t.remaining ?? 0;
        return (
          <li key={t.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span className="flex items-center gap-2">
              <span className={`size-3 rounded-full ${SWATCH[t.color]}`} aria-hidden="true" />
              {t.name}
            </span>
            <span className="flex items-center gap-3">
              <b>{formatMoney(t.price, event.currency)}</b>
              <span
                className={
                  left === 0 ? 'text-gray-500' : left < 20 ? 'text-amber-700' : 'text-gray-600'
                }
              >
                {left === 0 ? 'Sold out' : `${left} left`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function EventPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const me = useMe();
  const query = useEvent(slug);
  const event = query.data?.event;
  const map = useSeatMap(event?.id);
  const visualOf = useStatusVisuals(map.data);
  const [highlightTier, setHighlightTier] = useState<number | null>(null);

  if (query.isPending) return <LoadingRows />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <EventNotFound />;
    return <LoadError error={query.error} onRetry={() => query.refetch()} />;
  }
  if (!event) return null;

  const isGuest = !me.isPending && !me.data;
  const hasSeats = (map.data?.seats.length ?? 0) > 0;

  return (
    <article className="mx-auto max-w-4xl space-y-6">
      <div className={`h-32 rounded-xl ${SWATCH[event.coverColor]}`} aria-hidden="true" />
      {event.phase === 'cancelled' && (
        <p role="alert" className="rounded-md bg-red-600 p-3 font-medium text-white">
          This event was cancelled
        </p>
      )}
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-2xl font-semibold wrap-anywhere">{event.title}</h1>
          {event.phase !== 'on_sale' && <PhaseBadge phase={event.phase} />}
        </div>
        {event.summary && <p className="text-gray-700">{event.summary}</p>}
        <EventTime event={event} />
        <p className="text-gray-600">
          {event.venue.name}
          {event.venue.address && `, ${event.venue.address}`} · {event.venue.city}
        </p>
        {event.organizerName && (
          <p className="text-sm text-gray-600">Organized by {event.organizerName}</p>
        )}
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
        <div>{event.description && <MarkdownView>{event.description}</MarkdownView>}</div>
        <div className="space-y-3">
          <TierList event={event} />
          <CallToAction event={event} />
        </div>
      </div>

      {map.isError && <LoadError error={map.error} onRetry={() => map.refetch()} />}
      {map.data && hasSeats && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">The venue</h2>
          {isGuest && event.phase === 'on_sale' && (
            <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">
              <Link
                to={`/login?returnTo=${encodeURIComponent(`/e/${event.slug}/seats`)}`}
                className="font-medium underline"
              >
                Log in to choose seats
              </Link>
            </p>
          )}
          <Legend data={map.data} highlightTier={highlightTier} onHighlight={setHighlightTier} />
          <SeatMapViewer
            embedded
            data={map.data}
            visualOf={visualOf}
            highlightTier={highlightTier}
          />
        </section>
      )}
    </article>
  );
}
