import { useEffect, useRef } from 'react';
import type { ServerToClientEvents } from '@seatbook/shared';
import { getSocket } from './client';

type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

export type StaffRoomHandlers = {
  onCheckin?: (p: Payload<'checkin:recorded'>) => void;
  onSales?: (p: Payload<'sales:updated'>) => void;
  /** After a reconnect: messages sent while offline aren't replayed (FR-RT-11), so refetch. */
  onReconnect?: () => void;
};

/**
 * The event's staff room (organizer and admins): check-ins from every gate and sales as they
 * happen. Used by the check-in page and the dashboard.
 */
export function useStaffRoom(eventId: string, on: StaffRoomHandlers) {
  const handlers = useRef(on);
  useEffect(() => {
    handlers.current = on; // the latest callbacks, without leaving and re-joining the room
  });

  useEffect(() => {
    if (!eventId) return;
    const s = getSocket();
    let joinedOnce = false;
    const join = () =>
      s.emit('staff:join', { eventId }, (r) => {
        if (!r.ok) console.warn('staff:join', r.code);
      });
    const onConnect = () => {
      join();
      if (joinedOnce) handlers.current.onReconnect?.();
      joinedOnce = true;
    };
    const onCheckin = (p: Payload<'checkin:recorded'>) => {
      if (p.eventId === eventId) handlers.current.onCheckin?.(p);
    };
    const onSales = (p: Payload<'sales:updated'>) => {
      if (p.eventId === eventId) handlers.current.onSales?.(p);
    };

    s.on('connect', onConnect);
    s.on('checkin:recorded', onCheckin);
    s.on('sales:updated', onSales);
    if (s.connected) {
      join();
      joinedOnce = true;
    }
    return () => {
      if (s.connected) s.emit('staff:leave', { eventId });
      s.off('connect', onConnect);
      s.off('checkin:recorded', onCheckin);
      s.off('sales:updated', onSales);
    };
  }, [eventId]);
}
