export const CELL = 12; // SVG units per grid cell
export const SEAT_R = 4.6; // seat circle radius (leaves a gap between seats)
export const PAD = 3; // cells of padding around the map

export function bounds(points: { x: number; y: number }[]) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 20, maxY: 10 };
  // A loop, not Math.min(...points): spreading thousands of arguments can overflow the stack.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function viewBox(b: ReturnType<typeof bounds>) {
  const x = (b.minX - PAD) * CELL;
  const y = (b.minY - PAD - 3) * CELL; // extra room for the stage
  const w = (b.maxX - b.minX + 2 * PAD + 1) * CELL;
  const h = (b.maxY - b.minY + 2 * PAD + 4) * CELL;
  return `${x} ${y} ${w} ${h}`;
}
