import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { qk } from '@/api/keys';
import { clearHold } from './useHold';
import { URGENT_MS, mmss, useCountdown } from './useCountdown';

/** What a screen reader hears: only these moments, never every second. */
function announcement(ms: number) {
  if (ms <= 30_000) return 'Your seats will be released in 30 seconds.';
  if (ms <= 60_000) return 'Your seats will be released in 1 minute.';
  if (ms <= URGENT_MS) return 'Your seats will be released in 2 minutes.';
  return '';
}

export function CountdownBanner(props: {
  eventId: string;
  expiresAt: string;
  checkoutInProgress: boolean;
}) {
  const { eventId, expiresAt, checkoutInProgress } = props;
  const qc = useQueryClient();
  const ms = useCountdown(expiresAt);
  const expired = ms === 0;

  useEffect(() => {
    if (!expired) return;
    toast.error('Your seats were released.', {
      description: 'The hold ran out. You can pick seats again.',
    }); // FR-HOLD-15
    clearHold(qc, eventId);
    qc.invalidateQueries({ queryKey: qk.seatMap(eventId) });
  }, [expired, eventId, qc]);

  if (expired) return null;
  const urgent = ms < URGENT_MS;
  return (
    <div
      data-testid="countdown"
      data-urgent={urgent}
      className={`flex min-h-10 items-center justify-between rounded-lg px-4 py-2 text-sm font-medium ${urgent ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}
    >
      <span>{checkoutInProgress ? 'Completing payment…' : 'Seats held for'}</span>
      <span role="timer" className="font-mono text-base tabular-nums">
        {mmss(ms)}
      </span>
      <span role="status" className="sr-only">
        {announcement(ms)}
      </span>
    </div>
  );
}

/** The same time, for the phone's summary bar. The banner above handles running out. */
export function CountdownText({ expiresAt }: { expiresAt: string }) {
  const ms = useCountdown(expiresAt);
  return (
    <span className={`font-mono tabular-nums ${ms < URGENT_MS ? 'text-red-700' : ''}`}>
      {mmss(ms)}
    </span>
  );
}
