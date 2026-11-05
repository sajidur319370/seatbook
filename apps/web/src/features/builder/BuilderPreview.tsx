import { memo, useDeferredValue } from 'react';
import { CELL, SEAT_R, bounds, viewBox } from '@/components/seatmap/geometry';
import { TIER_HEX } from '@/components/seatmap/tierColors';
import { useBuilder, type Layout } from './builderStore';
import { deriveLayout } from './useBuilderDerived';

export function BuilderPreview({ readOnly }: { readOnly: boolean }) {
  // Deferred + memo: React can drop a half-finished redraw when the next key arrives.
  const layout = useDeferredValue(useBuilder((s) => s.layout));
  const selected = useDeferredValue(useBuilder((s) => s.selectedSectionId));
  // A locked map has no section panel, so nothing should look selected.
  return <PreviewSvg layout={layout} selected={readOnly ? null : selected} readOnly={readOnly} />;
}

const PreviewSvg = memo(function PreviewSvg(props: {
  layout: Layout;
  selected: string | null;
  readOnly: boolean;
}) {
  const { layout, selected, readOnly } = props;
  const { seats, tooManyToDraw, total } = deriveLayout(layout);
  const { stageLabel, sections, tiers } = layout;
  const toggleBlocked = useBuilder((s) => s.toggleBlocked);
  const tierColor = new Map(tiers.map((t) => [t._id, TIER_HEX[t.color]]));
  const b = bounds(seats);

  if (tooManyToDraw) {
    return (
      <div className="grid h-[60vh] place-items-center rounded-lg border bg-white p-4 text-center text-gray-600">
        {total.toLocaleString()} seats is too many to draw. Reduce the layout to preview it.
      </div>
    );
  }

  return (
    <svg
      viewBox={viewBox(b)}
      className="h-[60vh] w-full rounded-lg border bg-white"
      role="group"
      aria-label="Seat map preview"
    >
      <defs>
        <pattern
          id="hatch"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="4" stroke="#6b7280" strokeWidth="1.5" />
        </pattern>
      </defs>

      {/* Stage */}
      <rect
        x={b.minX * CELL}
        y={(b.minY - 3) * CELL}
        width={(b.maxX - b.minX + 1) * CELL}
        height={CELL * 1.6}
        rx={4}
        fill="#111827"
      />
      <text
        x={((b.minX + b.maxX + 1) / 2) * CELL}
        y={(b.minY - 2.2) * CELL}
        textAnchor="middle"
        fill="white"
        fontSize={8}
        dominantBaseline="middle"
      >
        {stageLabel}
      </text>

      {/* Row labels: left of the first seat of each row */}
      {sections.flatMap((s) =>
        s.rows.map((r, i) => (
          <text
            key={`${s._id}-${i}`}
            x={((s.x || 0) + (r.offset || 0) - 0.8) * CELL}
            y={((s.y || 0) + i) * CELL + 2.5}
            fontSize={7}
            fill="#6b7280"
            textAnchor="end"
          >
            {r.label}
          </text>
        )),
      )}

      {seats.map((seat, i) => (
        <PreviewSeat
          key={i}
          cx={seat.x * CELL}
          cy={seat.y * CELL}
          label={seat.label}
          blocked={seat.blocked}
          sectionId={seat.sectionId}
          row={seat.row}
          number={seat.number}
          color={tierColor.get(seat.tierId) ?? '#d1d5db'}
          dim={!!selected && seat.sectionId !== selected}
          onToggle={readOnly ? undefined : toggleBlocked}
        />
      ))}
    </svg>
  );
});

/** Only primitives and a stable function: otherwise memo re-renders all 5,000 seats per keystroke. */
const PreviewSeat = memo(function PreviewSeat(p: {
  cx: number;
  cy: number;
  label: string;
  blocked: boolean;
  sectionId: string;
  row: string;
  number: number;
  color: string;
  dim: boolean;
  onToggle?: (sectionId: string, row: string, n: number) => void;
}) {
  return (
    <circle
      cx={p.cx}
      cy={p.cy}
      r={SEAT_R}
      fill={p.blocked ? 'url(#hatch)' : p.color}
      stroke={p.blocked ? '#6b7280' : undefined}
      strokeWidth={p.blocked ? 0.6 : undefined}
      opacity={p.dim ? 0.35 : 1}
      className={p.onToggle ? 'cursor-pointer' : undefined}
      data-seat={p.label}
      onClick={p.onToggle && (() => p.onToggle!(p.sectionId, p.row, p.number))}
    >
      <title>
        {p.label}
        {p.blocked ? ' (blocked)' : ''}
      </title>
    </circle>
  );
});
