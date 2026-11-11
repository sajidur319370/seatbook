import { useEffect, useRef } from 'react';
import type { CheckinRecordedPayload } from '@seatbook/shared';
import { getSocket } from '@/socket/client';

/** The event's staff room: every gate's scans, live (FR-CHK-07). Joins again after a reconnect. */
export function useStaffRoom(eventId: string, onCheckin: (p: CheckinRecordedPayload) => void) {
  const handler = useRef(onCheckin);
  useEffect(() => {
    handler.current = onCheckin;
  });

  useEffect(() => {
    if (!eventId) return;
    const s = getSocket();
    const join = () =>
      s.emit('staff:join', { eventId }, (r) => {
        if (!r.ok) console.warn('staff:join', r.code);
      });
    const onRecorded = (p: CheckinRecordedPayload) => {
      if (p.eventId === eventId) handler.current(p);
    };
    s.on('connect', join);
    s.on('checkin:recorded', onRecorded);
    if (s.connected) join();
    return () => {
      if (s.connected) s.emit('staff:leave', { eventId });
      s.off('connect', join);
      s.off('checkin:recorded', onRecorded);
    };
  }, [eventId]);
}
