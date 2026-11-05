import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import type { OrganizerEventDto } from '@seatbook/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBuilder, type Layout } from './builderStore';
import { BuilderPreview } from './BuilderPreview';
import { RowsPanel, SectionsPanel, TemplatesPanel, TiersPanel, TotalsPanel } from './BuilderPanels';
import { deriveLayout, useBuilderDerived } from './useBuilderDerived';

export function SeatMapTab(props: { event: OrganizerEventDto; onReload: () => Promise<unknown> }) {
  const { event } = props;
  const qc = useQueryClient();
  const loadedEvent = useBuilder((s) => s.eventId);
  const dirty = useBuilder((s) => s.dirty);
  const isEmpty = useBuilder((s) => s.layout.sections.length === 0);
  const { errors } = useBuilderDerived();
  const [stale, setStale] = useState(false);
  const locked = event.status !== 'draft';

  const save = useMutation({
    mutationFn: (layout: Layout) =>
      http.put<{ event: OrganizerEventDto }>(`/organizer/events/${event.id}/seat-map`, {
        ...layout,
        expectedRevision: useBuilder.getState().revision,
      }),
    onSuccess: ({ event: saved }, sent) => {
      useBuilder.getState().markSaved(sent, saved.seatMap, saved.revision);
      qc.setQueryData(qk.organizerEvent(event.id), saved);
      toast.success('Seat map saved');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'STALE_DRAFT') setStale(true);
      else toast.error(err.message);
    },
  });

  if (loadedEvent !== event.id) return <Skeleton className="h-96 w-full" />;

  if (locked) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          The seat map is locked after publishing. Prices and seats can't change.
        </p>
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <BuilderPreview readOnly />
          <TotalsPanel currency={event.currency} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TemplatesPanel />
        <div className="flex items-center gap-3">
          {dirty && <span className="text-sm text-amber-700">Unsaved changes</span>}
          <Button
            disabled={errors.length > 0 || !dirty || save.isPending}
            onClick={() => {
              // The button reflects a slightly deferred layout, so check the current one.
              const { layout } = useBuilder.getState();
              if (deriveLayout(layout).errors.length === 0) save.mutate(layout);
            }}
          >
            {save.isPending ? 'Saving…' : 'Save seat map'}
          </Button>
        </div>
      </div>

      {errors.length > 0 && !isEmpty && (
        <p role="alert" className="rounded-md bg-red-600 p-3 text-sm font-medium text-white">
          {errors.length === 1 ? 'There is 1 problem' : `There are ${errors.length} problems`} to
          fix before saving. {errors.find((e) => e.path.length <= 1)?.message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <BuilderPreview readOnly={false} />
        <div className="space-y-4">
          <TotalsPanel currency={event.currency} />
          <TiersPanel currency={event.currency} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <SectionsPanel />
        <RowsPanel />
      </div>

      <AlertDialog open={stale}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This event was changed in another tab</AlertDialogTitle>
            <AlertDialogDescription>
              Reload to see the latest version. Your unsaved seat map changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={async () => {
                setStale(false);
                await props.onReload();
              }}
            >
              Reload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
