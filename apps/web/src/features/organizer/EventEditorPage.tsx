import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { OrganizerEventDto } from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { LoadError, LoadingRows } from '@/components/QueryStates';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PublishTab } from '@/features/builder/PublishTab';
import { SeatMapTab } from '@/features/builder/SeatMapTab';
import { useBuilder } from '@/features/builder/builderStore';
import { useBuilderSync, useUnsavedGuard } from '@/features/builder/useBuilderSync';
import { EventDetailsForm } from './EventDetailsForm';
import { PhaseBadge } from '@/components/PhaseBadge';
import { useOrganizerEvent } from './useOrganizerEvents';

function Editor(props: {
  event: OrganizerEventDto;
  refetch: () => Promise<OrganizerEventDto | undefined>;
}) {
  const { event } = props;
  const [tab, setTab] = useState('details');
  const blocker = useUnsavedGuard();
  useBuilderSync(event);

  /** Fetches the latest event and throws away unsaved seat-map work (the user chose Reload). */
  const reloadBuilder = async () => {
    const fresh = await props.refetch();
    if (fresh) useBuilder.getState().load(fresh.id, fresh.seatMap, fresh.revision);
  };

  return (
    <div className={`mx-auto space-y-4 ${tab === 'seat-map' ? 'max-w-6xl' : 'max-w-3xl'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{event.title}</h1>
        <PhaseBadge phase={event.phase} />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="seat-map">Seat map</TabsTrigger>
          <TabsTrigger value="publish">Publish</TabsTrigger>
        </TabsList>
        {/* forceMount keeps unsaved details when you switch tabs. */}
        <TabsContent value="details" forceMount className="data-[state=inactive]:hidden">
          <Card className="p-6">
            <EventDetailsForm key={event.id} event={event} onReload={props.refetch} />
          </Card>
        </TabsContent>
        <TabsContent value="seat-map">
          <SeatMapTab event={event} onReload={reloadBuilder} />
        </TabsContent>
        <TabsContent value="publish">
          <PublishTab event={event} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Your seat map changes will be lost if you leave this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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

  return <Editor event={query.data} refetch={() => query.refetch().then((r) => r.data)} />;
}
