import { Link } from 'react-router';
import { formatMoney } from '@seatbook/shared';
import { EmptyState, LoadError, LoadMore, LoadingRows } from '@/components/QueryStates';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatEventTime } from '@/lib/eventTime';
import { PhaseBadge, percentSold } from '@/components/PhaseBadge';
import { OrganizerOverview } from '@/features/dashboard/OrganizerOverview';
import { useMyEvents } from './useOrganizerEvents';

export function MyEventsPage() {
  const query = useMyEvents();
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const newEvent = (
    <Button asChild>
      <Link to="/organizer/events/new">New event</Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Organizer</h1>
      <OrganizerOverview />
      <div className="flex items-center justify-between gap-2 pt-2">
        <h2 className="text-xl font-semibold">My events</h2>
        {rows.length > 0 && newEvent}
      </div>

      {query.isPending ? (
        <LoadingRows />
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="You haven't created any events yet">{newEvent}</EmptyState>
      ) : (
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell>{formatEventTime(e.startsAt, e.timezone)}</TableCell>
                  <TableCell>
                    <PhaseBadge phase={e.phase} />
                  </TableCell>
                  <TableCell className="text-right">{percentSold(e)}</TableCell>
                  <TableCell className="text-right">
                    {formatMoney(e.counters.revenue, e.currency)}
                  </TableCell>
                  <TableCell className="space-x-3 text-right whitespace-nowrap">
                    {e.status === 'published' && (
                      <>
                        <Link
                          to={`/organizer/events/${e.id}/dashboard`}
                          className="text-blue-600 hover:underline"
                        >
                          Dashboard
                        </Link>
                        <Link
                          to={`/organizer/events/${e.id}/attendees`}
                          className="text-blue-600 hover:underline"
                        >
                          Attendees
                        </Link>
                        <Link
                          to={`/organizer/events/${e.id}/check-in`}
                          className="text-blue-600 hover:underline"
                        >
                          Check-in
                        </Link>
                      </>
                    )}
                    <Link
                      to={`/organizer/events/${e.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      Edit
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <LoadMore
        hasMore={query.hasNextPage}
        loading={query.isFetchingNextPage}
        onClick={() => query.fetchNextPage()}
      />
    </div>
  );
}
