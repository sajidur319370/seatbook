import { useMemo } from 'react';
import { formatMoney, seatLabel, type SeatMapResponse } from '@seatbook/shared';

export interface RenderSeat {
  id: string;
  x: number;
  y: number;
  label: string; // derived: ORC-A12
  section: string;
  row: string;
  n: number;
  tierIndex: number;
  price: number;
  description: string; // for screen readers: "Orchestra, row F, seat 7, Standard, BDT 40.00"
}

/**
 * Seats never move once published, so this runs once per layout, not once per click. A status change
 * makes a new `data` object, but the layout inside it stays the same object.
 */
const byLayout = new WeakMap<SeatMapResponse['layout'], RenderSeat[]>();

function renderSeatsFor(data: SeatMapResponse) {
  const known = byLayout.get(data.layout);
  if (known) return known;
  const seats = data.seats.map((c): RenderSeat => {
    const section = data.layout.sections[c.s]!;
    const tier = data.tiers[c.t]!;
    return {
      id: c.id,
      x: c.x,
      y: c.y,
      n: c.n,
      row: c.r,
      section: section.name,
      label: seatLabel(section.code, c.r, c.n),
      tierIndex: c.t,
      price: tier.price,
      description: `${section.name}, row ${c.r}, seat ${c.n}, ${tier.name}, ${formatMoney(tier.price, data.event.currency)}`,
    };
  });
  // The API returns seats in no fixed order. Reading order gives the keyboard one first seat.
  seats.sort((a, b) => a.y - b.y || a.x - b.x);
  byLayout.set(data.layout, seats);
  return seats;
}

/** The static part of each seat: positions, labels and prices. Statuses are read separately. */
export const useRenderSeats = (data: SeatMapResponse) =>
  useMemo(() => renderSeatsFor(data), [data]);

/** The nearest seat in the direction of an arrow key, preferring straight lines. */
export function nearestSeat(
  seats: RenderSeat[],
  from: RenderSeat,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
) {
  const [dx, dy] = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  }[key] as [number, number];
  let best: RenderSeat | null = null;
  let bestScore = Infinity;
  for (const s of seats) {
    const vx = s.x - from.x;
    const vy = s.y - from.y;
    const along = vx * dx + vy * dy; // distance in the arrow's direction
    if (along <= 0) continue;
    const across = Math.abs(vx * dy) + Math.abs(vy * dx); // sideways drift
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
