import { useDeferredValue } from 'react';
import { generateSeats, LIMITS, seatMapInputSchema, type GeneratedSeat } from '@seatbook/shared';
import { useBuilder, type Layout } from './builderStore';

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * The layout may hold anything mid-typing: a blank number, or a seat count of a billion, which
 * would hang the tab on every keystroke. The schema reports those; the preview draws a safe copy.
 */
function drawableSections(layout: Layout) {
  return layout.sections.slice(0, LIMITS.sectionsPerEvent).map((s) => ({
    ...s,
    x: finite(s.x),
    y: finite(s.y),
    rows: s.rows.slice(0, LIMITS.rowsPerSection).map((r) => ({
      ...r,
      offset: finite(r.offset),
      seats: Math.min(Math.max(0, Math.trunc(finite(r.seats))), LIMITS.seatsPerRow),
    })),
  }));
}

function derive(layout: Layout) {
  const generated = generateSeats({ sections: drawableSections(layout) });
  const tooManyToDraw = generated.length > LIMITS.seatsPerEvent;
  const seats: GeneratedSeat[] = tooManyToDraw ? [] : generated;

  const perTier = layout.tiers.map((tier) => {
    const sellable = seats.filter((s) => s.tierId === tier._id && !s.blocked).length;
    return { tier, sellable, potential: sellable * (finite(tier.price) || 0) };
  });
  const sellable = seats.filter((s) => !s.blocked).length;

  // expectedRevision is checked by the server; any valid value will do here.
  const parsed = seatMapInputSchema.safeParse({ ...layout, expectedRevision: 1 });
  const errors = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({
        path: i.path as (string | number)[],
        // An overlap also names the other seat's row, so it shows on both.
        otherPath: (i as { params?: { otherPath?: (string | number)[] } }).params?.otherPath,
        message: i.message,
      }));

  return {
    seats,
    tooManyToDraw,
    perTier,
    total: generated.length,
    sellable,
    blocked: seats.length - sellable,
    errors,
    errorsAt: (path: (string | number)[]) =>
      errors
        .filter(
          (e) =>
            path.every((p, i) => e.path[i] === p) || path.every((p, i) => e.otherPath?.[i] === p),
        )
        .map((e) => e.message),
  };
}

/** Several panels read this. One computation per layout, however many of them ask. */
const cache = new WeakMap<Layout, ReturnType<typeof derive>>();

export function deriveLayout(layout: Layout) {
  let derived = cache.get(layout);
  if (!derived) {
    derived = derive(layout);
    cache.set(layout, derived);
  }
  return derived;
}

/**
 * Deferred: a keystroke paints first, and totals and errors catch up right after. With 5,000 seats,
 * validating before painting would add a visible delay to every character typed.
 */
export function useBuilderDerived() {
  return deriveLayout(useDeferredValue(useBuilder((s) => s.layout)));
}
