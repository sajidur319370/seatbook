import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { HoldResponse, SeatCell, SeatChangeDto, SeatMapResponse } from '@seatbook/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { newMutationId } from '@/lib/mutationIds';
import { serverNow, timed } from '@/lib/serverClock';
import { applySeatChanges } from '@/socket/seatCache';
import { usePending } from './pendingStore';

export function useMyHold(eventId: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.hold(eventId),
    queryFn: async ({ signal }) => {
      const res = await timed(() => http.get<HoldResponse>(`/events/${eventId}/hold`, { signal }));
      // A click may have answered while this was on its way, and an older answer mustn't win.
      const cur = qc.getQueryData<HoldResponse>(qk.hold(eventId));
      return cur && cur.serverTime > res.serverTime ? cur : res;
    },
    enabled: !!eventId,
  });
}

/** Writes changes into the cached map with the version rule. Nothing changed means no new object. */
export function applyMapChanges(qc: QueryClient, eventId: string, changes: SeatChangeDto[]) {
  const map = qc.getQueryData<SeatMapResponse>(qk.seatMap(eventId));
  if (!map) return;
  const next = applySeatChanges(map, changes);
  if (next !== map) qc.setQueryData(qk.seatMap(eventId), next);
}

/** Patches one seat in the cached map, keeping every other cell's identity (memo!). */
export function patchSeat(
  qc: QueryClient,
  eventId: string,
  seatId: string,
  patch: Partial<SeatCell>,
) {
  qc.setQueryData<SeatMapResponse>(
    qk.seatMap(eventId),
    (d) => d && { ...d, seats: d.seats.map((c) => (c.id === seatId ? { ...c, ...patch } : c)) },
  );
}

/** Fast clicks can answer out of order, and an older answer mustn't undo a newer one. */
export function applyHold(qc: QueryClient, eventId: string, res: HoldResponse) {
  qc.setQueryData<HoldResponse>(qk.hold(eventId), (cur) =>
    !cur || cur.serverTime <= res.serverTime ? res : cur,
  );
}

/** Keeps the last server time rather than reading this device's clock, which may be wrong (E22). */
export function clearHold(qc: QueryClient, eventId: string) {
  qc.setQueryData<HoldResponse>(qk.hold(eventId), (cur) => ({
    serverTime: cur?.serverTime ?? new Date(serverNow()).toISOString(),
    hold: null,
  }));
}

/** After overlapping requests, ask for the truth: each answer only saw part of the picture. */
function finish(qc: QueryClient, eventId: string, seatIds: string[]) {
  const ended = seatIds.map((id) => usePending.getState().remove(id)).some(Boolean);
  if (ended) qc.invalidateQueries({ queryKey: qk.hold(eventId) });
}

/** The global handler in queryClient.ts deals with these, by sending the user to log in. */
const handledGlobally = (err: ApiError) => err.status === 401 || err.code === 'ACCOUNT_SUSPENDED';

export function useAddSeat(eventId: string) {
  const qc = useQueryClient();

  return useMutation({
    networkMode: 'always', // offline, fail now. Paused, the click would take a seat minutes later.
    mutationFn: async (seatId: string) => {
      const send = () =>
        timed(() =>
          http.post<HoldResponse>(
            `/events/${eventId}/hold/seats`,
            { seatId },
            { clientMutationId: newMutationId() },
          ),
        );
      try {
        return await send();
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'HOLD_EXPIRED') throw err;
        clearHold(qc, eventId); // FR-HOLD-14: my old hold ran out mid-click, so retry once
        return send();
      }
    },
    onMutate: (seatId) => usePending.getState().add(seatId),
    onSuccess: (res) => {
      applyHold(qc, eventId, res);
      applyMapChanges(qc, eventId, res.changes ?? []);
    },
    onError: (err, seatId) => {
      if (!(err instanceof ApiError)) {
        toast.error('Network problem. Try again.');
        return;
      }
      if (handledGlobally(err)) return;
      switch (err.code) {
        case 'SEAT_UNAVAILABLE':
          patchSeat(qc, eventId, seatId, { st: 'held' }); // show it as taken right away (E1)
          toast('Someone just took that seat.', { description: 'Pick another one.' });
          break;
        case 'EVENT_NOT_ON_SALE':
          toast.error(err.message);
          qc.invalidateQueries({ queryKey: ['event'] });
          break;
        case 'NOT_FOUND':
          toast.error('This event or seat is no longer available.');
          qc.invalidateQueries({ queryKey: ['event'] });
          break;
        default:
          toast.error(err.message); // "You can hold up to 8 seats.", "Slow down…"
      }
    },
    onSettled: (_d, _e, seatId) => finish(qc, eventId, [seatId]),
  });
}

function releaseFailed(qc: QueryClient, eventId: string, err: unknown) {
  if (!(err instanceof ApiError)) {
    toast.error('Network problem. Try again.');
  } else if (handledGlobally(err)) {
    return;
  } else if (err.code === 'CHECKOUT_IN_PROGRESS') {
    toast.error('Payment in progress: seats are locked.');
  } else if (err.status === 404) {
    // It was already gone, say from another tab or because the timer ran out. Catch up.
    qc.invalidateQueries({ queryKey: qk.hold(eventId) });
    qc.invalidateQueries({ queryKey: qk.seatMap(eventId) });
  } else {
    toast.error('Could not release the seat.');
  }
}

export function useRemoveSeat(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (seatId: string) =>
      timed(() =>
        http.delete<HoldResponse>(`/events/${eventId}/hold/seats/${seatId}`, undefined, {
          clientMutationId: newMutationId(),
        }),
      ),
    onMutate: (seatId) => usePending.getState().add(seatId), // a second click can't send it twice
    onSuccess: (res) => {
      applyHold(qc, eventId, res);
      applyMapChanges(qc, eventId, res.changes ?? []);
    },
    onError: (err) => releaseFailed(qc, eventId, err),
    onSettled: (_d, _e, seatId) => finish(qc, eventId, [seatId]),
  });
}

export function useReleaseAll(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (_seatIds: string[]) =>
      timed(() =>
        http.delete<HoldResponse>(`/events/${eventId}/hold`, undefined, {
          clientMutationId: newMutationId(),
        }),
      ),
    onMutate: (seatIds) => seatIds.forEach((id) => usePending.getState().add(id)),
    onSuccess: (res) => {
      applyHold(qc, eventId, res);
      applyMapChanges(qc, eventId, res.changes ?? []);
    },
    onError: (err) => releaseFailed(qc, eventId, err),
    onSettled: (_d, _e, seatIds) => finish(qc, eventId, seatIds),
  });
}
