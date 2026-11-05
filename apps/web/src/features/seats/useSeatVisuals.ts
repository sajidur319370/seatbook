import { useCallback, useMemo } from 'react';
import type { SeatMapResponse } from '@seatbook/shared';
import type { SeatVisual } from '@/components/seatmap/Seat';
import { usePending } from './pendingStore';
import { useMyHold } from './useHold';

/** One seat's look = seat map (server) + my hold (server) + my clicks in flight (local). */
export function useSeatVisuals(eventId: string, map: SeatMapResponse | undefined) {
  const hold = useMyHold(eventId).data?.hold;
  const pending = usePending((s) => s.ids);

  const mine = useMemo(() => new Set(hold?.seats.map((s) => s.id) ?? []), [hold]);
  const status = useMemo(() => new Map(map?.seats.map((c) => [c.id, c.st]) ?? []), [map?.seats]);

  return useCallback(
    (id: string): SeatVisual => {
      if (pending.has(id)) return 'pending';
      if (mine.has(id)) return 'mine';
      return status.get(id) ?? 'blocked';
    },
    [pending, mine, status],
  );
}
