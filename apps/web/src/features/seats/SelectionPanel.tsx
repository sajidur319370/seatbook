import { useState } from 'react';
import { ChevronUp, X } from 'lucide-react';
import { Link } from 'react-router';
import { formatMoney, type HoldDto, type PublicEventDto } from '@seatbook/shared';
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
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { CountdownText } from './CountdownBanner';
import { usePending } from './pendingStore';

const seatsText = (n: number) => (n === 1 ? '1 seat' : `${n} seats`);

/** FR-VIEW-06: my seats, the total, and the way to checkout. */
function PanelBody(props: {
  event: PublicEventDto;
  hold: HoldDto | null;
  onRemove: (seatId: string) => void;
  onReleaseAll: (seatIds: string[]) => void;
}) {
  const { event, hold, onRemove, onReleaseAll } = props;
  const pending = usePending((s) => s.ids);
  const [confirming, setConfirming] = useState(false);
  const seats = hold?.seats ?? [];
  const locked = !!hold?.checkoutInProgress;

  return (
    <div className="space-y-3">
      <h2 className="font-semibold">
        Your seats ({seats.length} of {event.maxSeatsPerOrder})
      </h2>
      {seats.length === 0 ? (
        <p className="text-sm text-gray-600">Choose a seat on the map to hold it for 10 minutes.</p>
      ) : (
        <ul className="divide-y" data-testid="my-seats">
          {seats.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <b>{s.label}</b>
                <span className="block text-gray-600">
                  {s.section} · Row {s.row} · Seat {s.number} · {s.tierName}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {formatMoney(s.price, event.currency)}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Release seat ${s.label}`}
                  disabled={pending.has(s.id) || locked}
                  onClick={() => onRemove(s.id)}
                >
                  <X className="size-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {hold && seats.length > 0 && (
        <div className="flex justify-between border-t pt-2 font-semibold">
          <span>Total</span>
          <span data-testid="hold-total">{formatMoney(hold.total, hold.currency)}</span>
        </div>
      )}
      {seats.length > 0 ? (
        <Button asChild className="w-full">
          <Link to={`/e/${event.slug}/checkout`}>Checkout</Link>
        </Button>
      ) : (
        <Button className="w-full" disabled>
          Checkout
        </Button>
      )}
      {seats.length > 0 && !locked && (
        <button
          type="button"
          className="w-full text-sm text-gray-600 underline"
          onClick={() => setConfirming(true)}
        >
          Release all
        </button>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release {seatsText(seats.length)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Someone else may take them straight away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => onReleaseAll(seats.map((s) => s.id))}>
              Release all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SelectionPanel(props: {
  event: PublicEventDto;
  hold: HoldDto | null;
  onRemove: (seatId: string) => void;
  onReleaseAll: (seatIds: string[]) => void;
}) {
  const { hold } = props;
  return (
    <>
      <aside className="hidden lg:block">
        <div className="sticky top-4 rounded-xl border bg-white p-4">
          <PanelBody {...props} />
        </div>
      </aside>

      {/* On a phone the map needs the room, so the panel is one line that opens upward. */}
      {hold && hold.seats.length > 0 && (
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              data-testid="selection-bar"
              className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t bg-white px-4 py-3 text-sm font-medium shadow-lg lg:hidden"
            >
              <span>
                {seatsText(hold.seats.length)} · {formatMoney(hold.total, hold.currency)}
              </span>
              <span className="flex items-center gap-1">
                <CountdownText expiresAt={hold.expiresAt} />
                <ChevronUp className="size-4" aria-hidden="true" />
              </span>
            </button>
          </SheetTrigger>
          <SheetContent className="max-h-[75vh] overflow-y-auto">
            <SheetTitle className="sr-only">Your seats</SheetTitle>
            <PanelBody {...props} />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
