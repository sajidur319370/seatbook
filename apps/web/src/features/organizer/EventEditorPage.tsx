import { Check, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import type { OrganizerEventDto } from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { LoadError, LoadingRows } from '@/components/QueryStates';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EventDetailsForm } from './EventDetailsForm';
import { PhaseBadge } from './PhaseBadge';
import { useOrganizerEvent } from './useOrganizerEvents';

function ChecklistItem({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Check className="size-4 text-green-600" aria-label="Done" />
      ) : (
        <X className="size-4 text-red-600" aria-label="Not done" />
      )}
      {children}
    </li>
  );
}

function PublishChecklist({ event }: { event: OrganizerEventDto }) {
  const hasSeats = event.seatMap.sections.some((s) => s.rows.length > 0);
  return (
    <ul className="space-y-2 text-sm">
      <ChecklistItem ok={event.title.length >= 3}>Title</ChecklistItem>
      <ChecklistItem ok={new Date(event.startsAt) > new Date()}>
        The event starts in the future
      </ChecklistItem>
      <ChecklistItem ok={hasSeats && event.seatMap.tiers.length > 0}>
        Seat map with price tiers
      </ChecklistItem>
    </ul>
  );
}

export function EventEditorPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const query = useOrganizerEvent(eventId);

  if (query.isPending) return <LoadingRows />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <div className="py-16 text-center">
          <h1 className="text-2xl font-semibold">Event not found</h1>
          <Link to="/organizer" className="text-blue-600 hover:underline">
            Back to my events
          </Link>
        </div>
      );
    }
    return <LoadError error={query.error} onRetry={() => query.refetch()} />;
  }

  const event = query.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{event.title}</h1>
        <PhaseBadge phase={event.phase} />
      </div>
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="seat-map">Seat map</TabsTrigger>
          <TabsTrigger value="publish">Publish</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <Card className="p-6">
            {/* A new revision remounts the form, so it can never keep editing stale values. */}
            <EventDetailsForm key={event.revision} event={event} onReload={() => query.refetch()} />
          </Card>
        </TabsContent>
        <TabsContent value="seat-map">
          <Card className="p-6 text-gray-600">The seat-map builder comes on Day 9.</Card>
        </TabsContent>
        <TabsContent value="publish">
          <Card className="p-6">
            <PublishChecklist event={event} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
