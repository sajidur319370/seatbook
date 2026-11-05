import { useMemo } from 'react';
import { formatMoney, type SeatMapResponse } from '@seatbook/shared';
import { STATUS_HEX, TIER_HEX } from './tierColors';

function StatusChip(props: { label: string; dot: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-xs text-gray-600">
      <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden="true">
        {props.dot}
      </svg>
      {props.label}
    </span>
  );
}

export function Legend(props: {
  data: SeatMapResponse;
  highlightTier: number | null;
  onHighlight: (tier: number | null) => void;
}) {
  const { data, highlightTier, onHighlight } = props;
  const remaining = useMemo(() => {
    const counts = data.tiers.map(() => 0);
    for (const c of data.seats) if (c.st === 'available') counts[c.t]! += 1;
    return counts;
  }, [data]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {data.tiers.map((t, i) => (
          <button
            key={t._id}
            type="button"
            aria-pressed={highlightTier === i}
            onClick={() => onHighlight(highlightTier === i ? null : i)}
            className={`flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-sm hover:bg-gray-50 ${highlightTier === i ? 'ring-2 ring-gray-900' : ''}`}
          >
            <span
              className="size-3 rounded-full"
              style={{ background: TIER_HEX[t.color] }}
              aria-hidden="true"
            />
            {t.name} · {formatMoney(t.price, data.event.currency)} ·{' '}
            <span data-testid={`tier-remaining-${i}`}>{remaining[i]} left</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <StatusChip label="Available" dot={<circle cx="6" cy="6" r="5" fill="#14b8a6" />} />
        <StatusChip
          label="Selected"
          dot={
            <>
              <circle
                cx="6"
                cy="6"
                r="4.5"
                fill="#14b8a6"
                stroke={STATUS_HEX.mine}
                strokeWidth="1.5"
              />
              <path d="M3.8 6 l1.6 1.6 l3 -3.2" stroke="white" fill="none" />
            </>
          }
        />
        <StatusChip
          label="Held by others"
          dot={
            <>
              <circle cx="6" cy="6" r="5" fill={STATUS_HEX.held} />
              <circle cx="6" cy="6" r="1.5" fill="white" />
            </>
          }
        />
        <StatusChip
          label="Sold"
          dot={
            <>
              <circle cx="6" cy="6" r="5" fill="#d1d5db" />
              <path d="M4 4 l4 4 M8 4 l-4 4" stroke="#6b7280" />
            </>
          }
        />
        <StatusChip
          label="Not for sale"
          dot={<circle cx="6" cy="6" r="4.5" fill="url(#hatch)" stroke="#6b7280" />}
        />
      </div>
    </div>
  );
}
