import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { LoadError, LoadingRows } from '@/components/QueryStates';
import { Legend } from '@/components/seatmap/Legend';
import { SeatMapViewer } from '@/components/seatmap/SeatMapViewer';
import { EventNotFound, useStatusVisuals } from './EventPage';
import { useEvent, useSeatMap } from './usePublicEvents';

/** The full-size map. Day 13 turns this into seat selection. */
export function SeatsPage() {
  const { slug = '' } = useParams<{ slug: string }>();
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
  if (map.isError) return <LoadError error={map.error} onRetry={() => map.refetch()} />;
  if (!map.data) return <LoadingRows />;

  return (
    <div className="space-y-3">
      <div>
        <Link to={`/e/${slug}`} className="text-sm text-blue-600 hover:underline">
          ← Back to the event
        </Link>
        <h1 className="text-2xl font-semibold wrap-anywhere">{event?.title}</h1>
        <p className="text-sm text-gray-600">
          Seat selection isn't open yet, but you can explore the map.
        </p>
      </div>
      <Legend data={map.data} highlightTier={highlightTier} onHighlight={setHighlightTier} />
      <SeatMapViewer data={map.data} visualOf={visualOf} highlightTier={highlightTier} />
    </div>
  );
}
