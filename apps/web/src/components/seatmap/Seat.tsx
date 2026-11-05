import { memo } from 'react';
import { CELL, SEAT_R } from './geometry';
import { STATUS_HEX } from './tierColors';

export type SeatVisual = 'available' | 'held' | 'booked' | 'blocked' | 'mine' | 'pending';

export const STATUS_TEXT: Record<SeatVisual, string> = {
  available: 'Available',
  held: 'Held by someone else',
  booked: 'Sold',
  blocked: 'Not for sale',
  mine: 'Selected by you',
  pending: 'Updating…',
};

const FILL: Record<Exclude<SeatVisual, 'available' | 'mine' | 'pending'>, string> = {
  held: STATUS_HEX.held,
  booked: '#d1d5db',
  blocked: 'url(#hatch)',
};
const DIMMED_FILL = '#e5e7eb';

const checkPath = (cx: number, cy: number) => `M${cx - 2.2} ${cy} l1.6 1.6 l3 -3.2`;
const crossPath = (cx: number, cy: number) =>
  `M${cx - 1.8} ${cy - 1.8} l3.6 3.6 M${cx + 1.8} ${cy - 1.8} l-3.6 3.6`;

/** Primitive props only, so `memo` can skip every seat that didn't change. */
export const Seat = memo(function Seat(p: {
  id: string;
  x: number;
  y: number;
  tierColor: string;
  visual: SeatVisual;
  /** Faded by the legend's tier highlight. It's still what `visual` says it is. */
  dimmed: boolean;
  label: string;
  description: string;
  interactive: boolean;
  /** Roving tabindex: 5,000 tab stops would be unusable, so only one seat takes focus. */
  tabbable: boolean;
}) {
  const cx = p.x * CELL;
  const cy = p.y * CELL;
  const fill = p.dimmed
    ? DIMMED_FILL
    : p.visual === 'available' || p.visual === 'mine' || p.visual === 'pending'
      ? p.tierColor
      : FILL[p.visual];
  return (
    <g
      data-seat-id={p.id}
      data-seat={p.label}
      data-visual={p.dimmed ? 'dimmed' : p.visual}
      {...(p.interactive && {
        role: 'button',
        tabIndex: p.tabbable ? 0 : -1,
        'aria-label': `${p.description}, ${STATUS_TEXT[p.visual]}`,
        'aria-pressed': p.visual === 'mine',
        className:
          'cursor-pointer outline-none [&:focus-visible>circle:first-of-type]:stroke-black [&:focus-visible>circle:first-of-type]:[stroke-width:2.5]',
      })}
    >
      <circle
        cx={cx}
        cy={cy}
        r={SEAT_R}
        fill={fill}
        stroke={p.visual === 'mine' ? STATUS_HEX.mine : p.visual === 'blocked' ? '#6b7280' : 'none'}
        strokeWidth={p.visual === 'mine' ? 2 : p.visual === 'blocked' ? 0.6 : 0}
        className={p.visual === 'pending' ? 'animate-pulse' : undefined}
      />
      {/* Status is never colour alone (NFR-A11Y-02): each has its own mark. */}
      {p.visual === 'mine' && (
        <path d={checkPath(cx, cy)} stroke="white" strokeWidth={1.4} fill="none" />
      )}
      {p.visual === 'held' && !p.dimmed && <circle cx={cx} cy={cy} r={1.4} fill="white" />}
      {p.visual === 'booked' && !p.dimmed && (
        <path d={crossPath(cx, cy)} stroke="#6b7280" strokeWidth={1} fill="none" />
      )}
    </g>
  );
});
