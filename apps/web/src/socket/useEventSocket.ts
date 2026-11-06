import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  HoldChangedPayload,
  HoldResponse,
  PublicEventDto,
  SeatChangeDto,
  SeatMapResponse,
  SeatsChangedPayload,
} from '@seatbook/shared';
import { qk } from '@/api/keys';
import { applyHold, applyMapChanges } from '@/features/seats/useHold';
import { isOwnMutation } from '@/lib/mutationIds';
import { serverNow } from '@/lib/serverClock';
import { getSocket } from './client';
import { applySeatChanges, expireLocally } from './seatCache';

/** Keeps one event's map live while it's on screen. Guests never connect, so they only get local expiry. */
export function useEventSocket(eventId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!eventId) return;
    const s = getSocket();
    const early: SeatChangeDto[] = []; // arrived before the first map did

    // After EVERY join, not only a reconnect. A map fetched before the join, or cached from an earlier
    // visit, has missed whatever happened outside the room. Messages aren't replayed (FR-RT-11).
    const join = () =>
      s.emit('event:join', { eventId }, (r) => {
        if (!r.ok) return console.warn('event:join', r.code);
        qc.invalidateQueries({ queryKey: qk.seatMap(eventId) });
        qc.invalidateQueries({ queryKey: qk.hold(eventId) });
      });

    const onSeats = (p: SeatsChangedPayload) => {
      if (p.eventId !== eventId || isOwnMutation(p.clientMutationId)) return; // echo (FR-RT-09)
      // The map on its way may be older than this message, and nothing else would correct it.
      if (qc.getQueryData(qk.seatMap(eventId))) applyMapChanges(qc, eventId, p.changes);
      else early.push(...p.changes);
    };

    const onHold = (p: HoldChangedPayload) => {
      if (p.eventId !== eventId || isOwnMutation(p.clientMutationId)) return;
      // Only if seats were still showing: the countdown says this itself when it gets there first.
      const wasShowing = !!qc.getQueryData<HoldResponse>(qk.hold(eventId))?.hold;
      if (p.reason === 'expired' && !p.hold && wasShowing) toast.error('Your seats were released.');
      applyHold(qc, eventId, { serverTime: p.serverTime, hold: p.hold });
    };

    const onEvent = (p: { eventId: string; event: PublicEventDto }) => {
      if (p.eventId !== eventId) return;
      let closed = false;
      qc.setQueriesData<{ event: PublicEventDto }>({ queryKey: ['event'] }, (old) => {
        if (old?.event.id !== eventId) return old;
        if (old.event.phase === 'on_sale' && p.event.phase !== 'on_sale') closed = true;
        return { event: { ...old.event, ...p.event } }; // the message has no description: keep ours
      });
      if (closed) toast.warning('This event is no longer on sale.'); // E13
    };

    // Local expiry (FR-EXP-05): one interval, not one timer per seat.
    const tick = setInterval(() => {
      const map = qc.getQueryData<SeatMapResponse>(qk.seatMap(eventId));
      if (!map) return;
      const hold = qc.getQueryData<HoldResponse>(qk.hold(eventId))?.hold;
      const current = early.length ? applySeatChanges(map, early.splice(0)) : map;
      const next = expireLocally(current, serverNow(), new Set(hold?.seats.map((x) => x.id)));
      if (next !== map) qc.setQueryData(qk.seatMap(eventId), next);
    }, 1000);

    s.on('connect', join);
    s.on('seats:changed', onSeats);
    s.on('hold:changed', onHold);
    s.on('event:updated', onEvent);
    if (s.connected) join();

    return () => {
      clearInterval(tick);
      if (s.connected) s.emit('event:leave', { eventId }); // offline, the room went with the connection
      s.off('connect', join);
      s.off('seats:changed', onSeats);
      s.off('hold:changed', onHold);
      s.off('event:updated', onEvent);
    };
  }, [eventId, qc]);
}
