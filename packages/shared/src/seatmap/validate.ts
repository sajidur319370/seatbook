import { LIMITS } from '../constants';
import { generateSeats } from './generate';
import type { SeatMapInput } from './schema';

export interface LayoutIssue {
  path: (string | number)[];
  message: string;
  params?: { issue: string; [key: string]: unknown };
}

/** A fully stacked layout could report 100,000 overlaps. The first few are enough to fix it. */
const MAX_SEAT_ISSUES = 20;

const hasDuplicates = (values: unknown[]) => new Set(values).size !== values.length;

/** Cross-field rules (FR-MAP-04). Returns issues with a path the builder can highlight. */
export function validateLayout(m: SeatMapInput): LayoutIssue[] {
  const issues: LayoutIssue[] = [];

  // Publish needs these unique: a repeated section id breaks uniq_seat_position and crashes it.
  const seenIds = new Set<string>();
  const uniqueId = (id: string, path: (string | number)[]) => {
    if (seenIds.has(id))
      issues.push({ path, message: 'Ids must be unique', params: { issue: 'DUPLICATE_ID' } });
    seenIds.add(id);
  };
  m.tiers.forEach((t, ti) => uniqueId(t._id.toLowerCase(), ['tiers', ti, '_id']));

  const tierIds = new Set(m.tiers.map((t) => t._id.toLowerCase()));
  const codes = new Set<string>();
  m.sections.forEach((s, si) => {
    uniqueId(s._id.toLowerCase(), ['sections', si, '_id']);
    if (codes.has(s.code))
      issues.push({
        path: ['sections', si, 'code'],
        message: 'Section codes must be unique',
        params: { issue: 'DUPLICATE_CODE' },
      });
    codes.add(s.code);
    const labels = new Set<string>();
    s.rows.forEach((r, ri) => {
      const at = ['sections', si, 'rows', ri];
      if (labels.has(r.label))
        issues.push({
          path: [...at, 'label'],
          message: 'Row labels must be unique in a section',
          params: { issue: 'DUPLICATE_ROW' },
        });
      labels.add(r.label);
      if (!tierIds.has(r.tierId.toLowerCase()))
        issues.push({
          path: [...at, 'tierId'],
          message: 'Unknown tier',
          params: { issue: 'UNKNOWN_TIER' },
        });
      if (r.gapsAfter.some((n) => n >= r.seats) || hasDuplicates(r.gapsAfter))
        issues.push({
          path: [...at, 'gapsAfter'],
          message: 'Gaps must be unique and come after a seat that exists',
          params: { issue: 'BAD_GAP' },
        });
      if (r.blocked.some((n) => n > r.seats) || hasDuplicates(r.blocked))
        issues.push({
          path: [...at, 'blocked'],
          message: 'Blocked seats must be unique and in range',
          params: { issue: 'BAD_BLOCKED' },
        });
    });
  });

  const seats = generateSeats(m);
  if (seats.length > LIMITS.seatsPerEvent) {
    issues.push({
      path: ['sections'],
      message: `At most ${LIMITS.seatsPerEvent} seats`,
      params: { issue: 'TOO_MANY_SEATS', count: seats.length },
    });
    return issues; // positions don't matter until the layout is small enough
  }

  const sectionIndex = new Map(m.sections.map((s, i) => [s._id, i]));
  const pathOf = (seat: (typeof seats)[number]) => {
    const si = sectionIndex.get(seat.sectionId) ?? 0;
    const ri = m.sections[si]?.rows.findIndex((r) => r.label === seat.row) ?? 0;
    return ['sections', si, 'rows', ri];
  };

  const at = new Map<string, (typeof seats)[number]>();
  let seatIssues = 0;
  for (const seat of seats) {
    if (seatIssues >= MAX_SEAT_ISSUES) break;
    const key = `${seat.x},${seat.y}`;
    const other = at.get(key);
    if (other) {
      seatIssues += 1;
      issues.push({
        path: pathOf(seat),
        message: `${seat.label} overlaps ${other.label}`,
        // Both seats' rows are involved, so the builder shows it on both.
        params: { issue: 'OVERLAP', seats: [other.label, seat.label], otherPath: pathOf(other) },
      });
    } else at.set(key, seat);
    if (seat.x > LIMITS.gridSize || seat.y > LIMITS.gridSize) {
      seatIssues += 1;
      issues.push({
        path: pathOf(seat),
        message: `${seat.label} is off the map`,
        params: { issue: 'OUT_OF_BOUNDS' },
      });
    }
  }
  return issues;
}
