import type { CheckInCounts, CheckInResponse } from '@seatbook/shared';
import { formatTimeOfDay } from '../../lib/eventTime';

export type Tone = 'ok' | 'warn' | 'bad';

/** What the door staff read on the result card: icon tone, a big word, then the details. */
export function describeResult(
  r: Pick<CheckInResponse, 'result' | 'ticket'>,
  timezone: string,
): { tone: Tone; title: string; detail: string } {
  const t = r.ticket;
  const seat = t ? [t.seatLabel, t.tierName, t.holderName].join(' · ') : '';
  switch (r.result) {
    case 'ok':
      return { tone: 'ok', title: 'Welcome', detail: seat };
    case 'already_checked_in': {
      const at = t?.checkedInAt ? ` at ${formatTimeOfDay(t.checkedInAt, timezone)}` : '';
      const by = t?.checkedInByName ? ` by ${t.checkedInByName}` : '';
      const gate = t?.checkedInGate ? ` (${t.checkedInGate})` : '';
      return { tone: 'bad', title: 'Already used', detail: `Used${at}${by}${gate}. ${seat}` };
    }
    case 'invalid':
      return {
        tone: 'bad',
        title: 'Not a valid ticket',
        detail: 'This code was not issued by SeatBook.',
      };
    case 'not_found':
      return {
        tone: 'bad',
        title: 'Code not found',
        detail: 'No ticket with this code for this event.',
      };
    case 'wrong_event':
      return {
        tone: 'warn',
        title: 'Ticket for another event',
        detail: 'Check the date and venue.',
      };
    case 'void':
      return { tone: 'bad', title: 'Ticket cancelled', detail: seat };
    case 'outside_window':
      return {
        tone: 'warn',
        title: "Check-in isn't open",
        detail: 'It opens 6 hours before the start and closes 2 hours after the end.',
      };
  }
}

/**
 * Our own answers and other gates' broadcasts can arrive out of order. The checked-in count only
 * ever goes up (no undo yet), so keep the highest one seen; `sold` comes with the newest message.
 */
export function mergeCounts(prev: CheckInCounts | null, next: CheckInCounts): CheckInCounts {
  if (!prev) return next;
  return { checkedIn: Math.max(prev.checkedIn, next.checkedIn), sold: next.sold };
}
