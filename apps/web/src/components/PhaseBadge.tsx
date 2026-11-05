import type { EventPhase, OrganizerEventDto } from '@seatbook/shared';

const PHASE_STYLE: Record<EventPhase, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-800',
  on_sale: 'bg-green-100 text-green-800',
  sales_closed: 'bg-amber-100 text-amber-800',
  ended: 'bg-gray-200 text-gray-600',
  cancelled: 'bg-red-100 text-red-800',
};

export const PhaseBadge = ({ phase }: { phase: EventPhase }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_STYLE[phase]}`}>
    {phase.replace('_', ' ')}
  </span>
);

export const percentSold = ({ counters }: Pick<OrganizerEventDto, 'counters'>) =>
  counters.seatsSellable
    ? `${Math.round((counters.seatsSold / counters.seatsSellable) * 100)}%`
    : '—';
