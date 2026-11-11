import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { AttendeeRow } from '@seatbook/shared';
import { EmptyState, LoadError, LoadingRows, LoadMore } from '@/components/QueryStates';
import { Input } from '@/components/ui/input';
import { TicketStatusChip } from '@/features/bookings/TicketStatusChip';
import { useOrganizerEvent } from '@/features/organizer/useOrganizerEvents';
import { useDebounced } from '@/lib/useDebounced';
import { useAttendees } from './useDashboard';

/** FR-DASH-06: who's coming, searchable by name, email, booking reference or seat. */
export function AttendeesPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim(), 300);
  useEffect(() => {
    setParams(q ? { q } : {}, { replace: true }); // shareable, and survives a reload
  }, [q, setParams]);

  const ev = useOrganizerEvent(eventId);
  const list = useAttendees(eventId, q);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const tz = ev.data?.timezone ?? 'UTC';

  return (
    <div className="space-y-4">
      <div>
        <Link
          to={`/organizer/events/${eventId}/dashboard`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-semibold wrap-anywhere">
          Attendees{ev.data ? ` · ${ev.data.title}` : ''}
        </h1>
      </div>
      <Input
        type="search"
        aria-label="Search attendees"
        placeholder="Search by name, email, booking reference or seat"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="max-w-md"
      />
      {list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState title={q ? `No attendees match “${q}”` : 'No tickets sold yet'} />
      ) : (
        <>
          <AttendeeTable rows={rows} tz={tz} />
          <AttendeeCards rows={rows} tz={tz} />
        </>
      )}
      <LoadMore
        hasMore={list.hasNextPage}
        loading={list.isFetchingNextPage}
        onClick={() => list.fetchNextPage()}
      />
    </div>
  );
}

function AttendeeTable({ rows, tz }: { rows: AttendeeRow[]; tz: string }) {
  return (
    <div className="hidden overflow-x-auto rounded-md border bg-white md:block">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            {['Holder', 'Email', 'Seat', 'Tier', 'Reference', 'Status'].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticketId} className="border-t">
              <td className="px-3 py-2 font-medium">{r.holderName}</td>
              <td className="px-3 py-2 break-all">{r.email}</td>
              <td className="px-3 py-2">{r.seatLabel}</td>
              <td className="px-3 py-2">{r.tierName}</td>
              <td className="px-3 py-2 font-mono">{r.reference}</td>
              <td className="px-3 py-2">
                <TicketStatusChip ticket={r} timezone={tz} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** On a phone, each attendee is a two-line card instead of a wide table. */
function AttendeeCards({ rows, tz }: { rows: AttendeeRow[]; tz: string }) {
  return (
    <ul className="divide-y rounded-md border bg-white md:hidden">
      {rows.map((r) => (
        <li key={r.ticketId} className="space-y-1 p-3 text-sm">
          <p className="flex justify-between gap-2">
            <b>{r.holderName}</b>
            <TicketStatusChip ticket={r} timezone={tz} />
          </p>
          <p className="text-gray-600 wrap-anywhere">
            {r.seatLabel} · {r.tierName} · <span className="font-mono">{r.reference}</span> ·{' '}
            {r.email}
          </p>
        </li>
      ))}
    </ul>
  );
}
