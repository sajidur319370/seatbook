import type { SeatMapInput } from './schema';

export interface GeneratedSeat {
  sectionId: string;
  row: string;
  number: number;
  label: string;
  x: number;
  y: number;
  tierId: string;
  blocked: boolean;
}

export function generateSeats(layout: Pick<SeatMapInput, 'sections'>): GeneratedSeat[] {
  const out: GeneratedSeat[] = [];
  for (const s of layout.sections) {
    s.rows.forEach((r, i) => {
      const gaps = new Set(r.gapsAfter);
      const blocked = new Set(r.blocked);
      const order = Array.from({ length: r.seats }, (_, k) =>
        s.numbering === 'rtl' ? r.seats - k : k + 1,
      );
      let column = r.offset;
      order.forEach((n, k) => {
        out.push({
          sectionId: s._id,
          row: r.label,
          number: n,
          label: `${s.code}-${r.label}${n}`,
          x: s.x + column,
          y: s.y + i,
          tierId: r.tierId,
          blocked: blocked.has(n),
        });
        column += 1;
        if (gaps.has(n) && k < order.length - 1) column += 1; // aisle after seat n
      });
    });
  }
  return out;
}
