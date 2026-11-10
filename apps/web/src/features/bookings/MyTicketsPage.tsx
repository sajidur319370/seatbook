import { Link } from 'react-router';
import { EmptyState, LoadError, LoadingRows } from '@/components/QueryStates';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatEventTime } from '@/lib/eventTime';
import { TicketStatusChip } from './TicketStatusChip';
import { useMyTickets } from './useBookings';

function TicketList({ when }: { when: 'upcoming' | 'past' }) {
  const q = useMyTickets(when);
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  if (!q.data.groups.length) {
    return (
      <EmptyState title={when === 'upcoming' ? 'No upcoming tickets' : 'No past tickets'}>
        {when === 'upcoming' && (
          <Link to="/" className="text-blue-600 hover:underline">
            Find an event
          </Link>
        )}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {q.data.groups.map(({ event, tickets }) => (
        <Card key={event.id} className="p-4">
          <h2 className="font-semibold wrap-anywhere">{event.title}</h2>
          <p className="text-sm text-gray-600">
            {formatEventTime(event.startsAt, event.timezone)} · {event.venueName}, {event.city}
          </p>
          <ul className="mt-2 divide-y">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/tickets/${t.id}`}
                  className="flex items-center justify-between gap-2 py-2 hover:bg-gray-50"
                >
                  <span className="text-sm">
                    <b>{t.seatLabel}</b>
                    <span className="text-gray-600"> · {t.tierName}</span>
                  </span>
                  <TicketStatusChip ticket={t} timezone={event.timezone} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/** FR-TKT-05. Each tab loads only when opened. */
export function MyTicketsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">My tickets</h1>
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-4">
          <TicketList when="upcoming" />
        </TabsContent>
        <TabsContent value="past" className="mt-4">
          <TicketList when="past" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
