import type { TicketSummaryDto } from '@seatbook/shared';
import { formatTimeOfDay } from '@/lib/eventTime';

/** FR-TKT-07: Valid · Checked in at 19:42 · Void. The time is the event's, wherever the phone is. */
export function TicketStatusChip(props: {
  ticket: Pick<TicketSummaryDto, 'status' | 'checkedInAt'>;
  timezone: string;
}) {
  const { status, checkedInAt } = props.ticket;
  const [text, style] =
    status === 'checked_in'
      ? [
          `Checked in${checkedInAt ? ` at ${formatTimeOfDay(checkedInAt, props.timezone)}` : ''}`,
          'bg-blue-50 text-blue-800',
        ]
      : status === 'void'
        ? ['Void', 'bg-red-50 text-red-800']
        : ['Valid', 'bg-green-50 text-green-800'];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {text}
    </span>
  );
}
