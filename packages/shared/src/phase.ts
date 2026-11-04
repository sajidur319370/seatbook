import type { EventPhase, EventStatus } from './constants';

export function eventPhase(
  e: {
    status: EventStatus;
    startsAt: Date | string;
    endsAt: Date | string;
    salesStartAt: Date | string | null;
    salesEndAt: Date | string | null;
  },
  now: Date = new Date(),
): EventPhase {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.status === 'draft') return 'draft';
  const t = now.getTime();
  const ms = (d: Date | string) => new Date(d).getTime();
  if (t >= ms(e.endsAt)) return 'ended';
  if (e.salesStartAt && t < ms(e.salesStartAt)) return 'scheduled';
  if (t >= ms(e.salesEndAt ?? e.startsAt)) return 'sales_closed';
  return 'on_sale';
}
