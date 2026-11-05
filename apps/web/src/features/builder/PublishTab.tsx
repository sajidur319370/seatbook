import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { OrganizerEventDto } from '@seatbook/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { FormField } from '@/components/FormField';
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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useBuilder } from './builderStore';
import { useBuilderDerived } from './useBuilderDerived';

function Item({ ok, children }: { ok: boolean; children: string }) {
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

const asEvent = (r: { event: OrganizerEventDto }) => r.event;

export function PublishTab({ event }: { event: OrganizerEventDto }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const dirty = useBuilder((s) => s.dirty);
  const freePrices = useBuilder((s) => s.layout.tiers.filter((t) => t.price === 0).length);
  const { errors, sellable } = useBuilderDerived();
  const [confirm, setConfirm] = useState<'publish' | 'unpublish' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typedTitle, setTypedTitle] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  const applied = (saved: OrganizerEventDto) => {
    qc.setQueryData(qk.organizerEvent(event.id), saved);
    return qc.invalidateQueries({ queryKey: ['organizer', 'events'] });
  };

  const publish = useMutation({
    mutationFn: () =>
      http
        .post<{ event: OrganizerEventDto }>(`/organizer/events/${event.id}/publish`)
        .then(asEvent),
    onSuccess: async (saved) => {
      setProblems([]);
      await applied(saved);
      toast.success('Your event is published');
    },
    onError: (err) => {
      toast.error(err.message);
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setProblems((err.details as { message: string }[]).map((d) => d.message));
      }
    },
  });

  const unpublish = useMutation({
    mutationFn: () =>
      http
        .post<{ event: OrganizerEventDto }>(`/organizer/events/${event.id}/unpublish`)
        .then(asEvent),
    onSuccess: async (saved) => {
      await applied(saved);
      toast.success('Back to draft');
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError && err.code === 'EVENT_HAS_BOOKINGS'
          ? 'People have bought tickets. You can only cancel this event.'
          : err.message,
      ),
  });

  const remove = useMutation({
    mutationFn: () => http.delete(`/organizer/events/${event.id}`),
    onSuccess: async () => {
      useBuilder.getState().reset(); // nothing left to protect, so the leave guard must not fire
      qc.removeQueries({ queryKey: qk.organizerEvent(event.id) });
      await qc.invalidateQueries({ queryKey: ['organizer', 'events'] });
      toast.success('Draft deleted');
      navigate('/organizer', { replace: true });
    },
    onError: (err) => toast.error(err.message),
  });

  if (event.status === 'cancelled') {
    return <Card className="p-6 text-gray-600">This event was cancelled.</Card>;
  }

  if (event.status === 'published') {
    return (
      <Card className="space-y-3 p-6">
        <p>This event is published. {event.counters.seatsSold} seats sold so far.</p>
        <Button variant="outline" onClick={() => setConfirm('unpublish')}>
          Unpublish
        </Button>
        <AlertDialog open={confirm === 'unpublish'} onOpenChange={() => setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unpublish this event?</AlertDialogTitle>
              <AlertDialogDescription>
                It goes back to a draft, disappears from the public list, and anyone choosing seats
                loses them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => unpublish.mutate()}>Unpublish</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    );
  }

  const now = new Date();
  const salesEnd = new Date(event.salesEndAt ?? event.startsAt);
  const checks = [
    [new Date(event.startsAt) > now, 'The event starts in the future'],
    [salesEnd > now, 'Sales end in the future'],
    [!dirty, 'Seat map saved'],
    [errors.length === 0, 'Seat map valid'],
    [sellable > 0, 'At least one seat for sale'],
  ] as const;
  const ready = checks.every(([ok]) => ok);

  return (
    <Card className="space-y-4 p-6">
      <ul className="space-y-2 text-sm">
        {checks.map(([ok, text]) => (
          <Item key={text} ok={ok}>
            {text}
          </Item>
        ))}
      </ul>
      {freePrices > 0 && (
        <p className="flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {freePrices === 1 ? '1 tier has' : `${freePrices} tiers have`} a price of 0. Free seats?
        </p>
      )}
      {problems.length > 0 && (
        <ul className="list-disc space-y-1 rounded-md bg-red-50 p-3 pl-6 text-sm text-red-800">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!ready || publish.isPending} onClick={() => setConfirm('publish')}>
          Publish
        </Button>
        <Button variant="outline" onClick={() => setDeleting(true)}>
          Delete draft
        </Button>
      </div>

      <AlertDialog open={confirm === 'publish'} onOpenChange={() => setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{sellable.toLocaleString()} seats will go on sale</AlertDialogTitle>
            <AlertDialogDescription>
              The seat map and prices can't be changed after this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => publish.mutate()}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Type the event's title to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormField id="confirm-title" label={event.title}>
            <Input
              id="confirm-title"
              value={typedTitle}
              onChange={(e) => setTypedTitle(e.target.value)}
            />
          </FormField>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={typedTitle !== event.title || remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
