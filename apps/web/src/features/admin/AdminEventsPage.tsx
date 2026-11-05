import { EmptyState, LoadError, LoadMore, LoadingRows } from '@/components/QueryStates';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PhaseBadge, percentSold } from '@/components/PhaseBadge';
import { formatEventTime } from '@/lib/eventTime';
import { useAdminEvents } from './useAdmin';

export function AdminEventsPage() {
  const query = useAdminEvents();
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">All events</h1>
      {query.isPending ? (
        <LoadingRows />
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No events yet" />
      ) : (
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Organizer</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead className="text-right">Sold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell>{e.organizerName}</TableCell>
                  <TableCell>
                    <PhaseBadge phase={e.phase} />
                  </TableCell>
                  <TableCell>{formatEventTime(e.startsAt, e.timezone)}</TableCell>
                  <TableCell className="text-right">{percentSold(e)}</TableCell>
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
