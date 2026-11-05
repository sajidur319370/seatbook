import { useMemo } from 'react';
import { seatLabel, type SeatMapResponse } from '@seatbook/shared';

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
}

/** The static part of each seat: positions, labels and prices. Statuses are read separately. */
export function useRenderSeats(data: SeatMapResponse) {
  return useMemo(
    () =>
      data.seats.map((c): RenderSeat => {
        const section = data.layout.sections[c.s]!;
        return {
          id: c.id,
          x: c.x,
          y: c.y,
          n: c.n,
          row: c.r,
          section: section.name,
          label: seatLabel(section.code, c.r, c.n),
          tierIndex: c.t,
          price: data.tiers[c.t]!.price,
        };
      }),
    [data],
  );
}
