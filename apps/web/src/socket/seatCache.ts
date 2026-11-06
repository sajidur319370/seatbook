import type { SeatChangeDto, SeatMapResponse } from '@seatbook/shared';

/** Apply a batch with the version rule. Returns the SAME object if nothing changed (no re-render). */
export function applySeatChanges(map: SeatMapResponse, changes: SeatChangeDto[]): SeatMapResponse {
  const byId = new Map(changes.map((c) => [c.seatId, c]));
  let changed = false;
  const seats = map.seats.map((cell) => {
    const c = byId.get(cell.id);
    if (!c || c.version <= cell.v) return cell; // unknown seat, stale or duplicate: keep identity
    changed = true;
    return { ...cell, st: c.status, v: c.version, exp: c.holdExpiresAt ?? undefined };
  });
  return changed ? { ...map, seats } : map;
}

/**
 * Local expiry: held seats whose time has passed look available. The version stays, so the server's
 * confirmation still applies.
 */
export function expireLocally(
  map: SeatMapResponse,
  nowMs: number,
  mine: Set<string>,
): SeatMapResponse {
  let changed = false;
  const seats = map.seats.map((cell) => {
    if (cell.st !== 'held' || !cell.exp || mine.has(cell.id)) return cell;
    if (new Date(cell.exp).getTime() > nowMs) return cell;
    changed = true;
    return { ...cell, st: 'available' as const, exp: undefined };
  });
  return changed ? { ...map, seats } : map;
}

/**
 * A fetched map is a snapshot, and a message may have arrived while it was on its way. The version
 * rule applies here too, or a slow answer would undo that message.
 */
export function keepNewerSeats(
  fresh: SeatMapResponse,
  cached: SeatMapResponse | undefined,
): SeatMapResponse {
  if (!cached) return fresh;
  const known = new Map(cached.seats.map((c) => [c.id, c]));
  let kept = false;
  const seats = fresh.seats.map((cell) => {
    const ours = known.get(cell.id);
    if (!ours || ours.v <= cell.v) return cell;
    kept = true;
    return ours;
  });
  return kept ? { ...fresh, seats } : fresh;
}
