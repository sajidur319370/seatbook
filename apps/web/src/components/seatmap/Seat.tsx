import { memo } from 'react';
import { CELL, SEAT_R } from './geometry';
import { STATUS_HEX } from './tierColors';

export type SeatVisual =
  'available' | 'held' | 'booked' | 'blocked' | 'mine' | 'pending' | 'dimmed';

const FILL: Record<Exclude<SeatVisual, 'available' | 'mine' | 'pending'>, string> = {
  held: STATUS_HEX.held,
  booked: '#d1d5db',
  blocked: 'url(#hatch)',
  dimmed: '#e5e7eb',
};

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
  label: string;
  interactive: boolean;
}) {
  const cx = p.x * CELL;
  const cy = p.y * CELL;
  const fill =
    p.visual === 'available' || p.visual === 'mine' || p.visual === 'pending'
      ? p.tierColor
      : FILL[p.visual];
  return (
    <g
      data-seat-id={p.id}
      data-seat={p.label}
      data-visual={p.visual}
      className={p.interactive ? 'cursor-pointer' : undefined}
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
      {p.visual === 'held' && <circle cx={cx} cy={cy} r={1.4} fill="white" />}
      {p.visual === 'booked' && (
        <path d={crossPath(cx, cy)} stroke="#6b7280" strokeWidth={1} fill="none" />
      )}
    </g>
  );
});
