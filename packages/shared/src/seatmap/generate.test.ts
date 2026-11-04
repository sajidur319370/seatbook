import { describe, expect, it } from 'vitest';
import { generateSeats } from './generate';
import { newId } from './ids';
import { seatMapInputSchema } from './schema';
import { concertHall, conferenceRoom, smallTheatre } from './templates';
import { validateLayout } from './validate';

const tier = { _id: 'a'.repeat(24), name: 'Std', price: 1000, color: 'teal' as const };
const row = (over = {}) => ({
  label: 'A',
  seats: 4,
  offset: 0,
  tierId: tier._id,
  gapsAfter: [] as number[],
  blocked: [] as number[],
  ...over,
});
const section = (over = {}) => ({
  _id: 'b'.repeat(24),
  name: 'Orchestra',
  code: 'ORC',
  x: 10,
  y: 5,
  numbering: 'ltr' as const,
  rows: [row({ gapsAfter: [2], blocked: [4] })],
  ...over,
});
const layout = (sections: ReturnType<typeof section>[], over = {}) => ({
  expectedRevision: 1,
  stageLabel: 'STAGE',
  tiers: [tier],
  sections,
  ...over,
});
const issueCodes = (issues: ReturnType<typeof validateLayout>) =>
  issues.map((i) => i.params?.issue);

describe('generateSeats', () => {
  it('labels, positions and gaps', () => {
    const seats = generateSeats({ sections: [section()] });
    expect(seats.map((s) => [s.label, s.x, s.y])).toEqual([
      ['ORC-A1', 10, 5],
      ['ORC-A2', 11, 5],
      ['ORC-A3', 13, 5], // x=12 is the aisle
      ['ORC-A4', 14, 5],
    ]);
    expect(seats.find((s) => s.number === 4)!.blocked).toBe(true);
  });

  it('rtl puts seat 1 on the right', () => {
    const seats = generateSeats({
      sections: [section({ numbering: 'rtl', rows: [row({ seats: 3 })] })],
    });
    expect(seats.map((s) => [s.number, s.x])).toEqual([
      [3, 10],
      [2, 11],
      [1, 12],
    ]);
  });

  it('offset indents a row, and each row moves down', () => {
    const seats = generateSeats({
      sections: [section({ rows: [row({ seats: 1 }), row({ label: 'B', seats: 1, offset: 3 })] })],
    });
    expect(seats.map((s) => [s.label, s.x, s.y])).toEqual([
      ['ORC-A1', 10, 5],
      ['ORC-B1', 13, 6],
    ]);
  });

  it('is pure: the same layout gives the same seats (AC-MAP-02)', () => {
    const t = concertHall();
    expect(generateSeats(t)).toEqual(generateSeats(t));
  });

  it('can generate 5,000 seats quickly enough for a keystroke', () => {
    const big = {
      sections: Array.from({ length: 20 }, (_, i) =>
        section({
          _id: newId(),
          code: `S${i}`,
          x: i * 11,
          rows: Array.from({ length: 25 }, (_, r) =>
            row({ label: String.fromCharCode(65 + r), seats: 10 }),
          ),
        }),
      ),
    };
    const start = performance.now();
    expect(generateSeats(big)).toHaveLength(5000);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe('templates', () => {
  it.each([
    ['smallTheatre', smallTheatre, 120, 0],
    ['concertHall', concertHall, 16 * 24 + 2 * 6 * 14, 4],
    ['conferenceRoom', conferenceRoom, 80, 0],
  ])('%s is valid and has the expected size', (_name, template, total, blocked) => {
    const t = template();
    expect(validateLayout({ ...t, expectedRevision: 1 })).toEqual([]);
    expect(seatMapInputSchema.safeParse({ ...t, expectedRevision: 1 }).success).toBe(true);
    const seats = generateSeats(t);
    expect(seats).toHaveLength(total);
    expect(seats.filter((s) => s.blocked)).toHaveLength(blocked);
  });
});

describe('validateLayout', () => {
  it('detects overlaps, naming both seats (AC-MAP-01)', () => {
    const a = section();
    const b = section({ _id: 'c'.repeat(24), code: 'B', x: 11 }); // lands on ORC's seats
    const overlap = validateLayout(layout([a, b])).find((i) => i.params?.issue === 'OVERLAP');
    expect(overlap?.params?.seats).toEqual(['ORC-A2', 'B-A1']);
  });

  it('reports only the first overlaps of a fully stacked layout', () => {
    const stacked = Array.from({ length: 20 }, (_, i) =>
      section({ _id: newId(), code: `S${i}`, rows: [row({ seats: 100 })] }),
    );
    const issues = validateLayout(layout(stacked));
    expect(issues.length).toBeLessThanOrEqual(20);
  });

  it('rejects more than 5,000 seats (AC-MAP-03)', () => {
    // 51 one-row sections of 100 seats = 5,100 seats, stacked so nothing overlaps.
    // (The Zod schema would also reject 51 sections; validateLayout is tested on its own here.)
    const big = Array.from({ length: 51 }, (_, i) =>
      section({
        _id: i.toString(16).padStart(24, '0'),
        code: `S${i}`,
        x: 0,
        y: i * 2,
        rows: [row({ seats: 100 })],
      }),
    );
    expect(issueCodes(validateLayout(layout(big)))).toContain('TOO_MANY_SEATS');
  });

  it('allows exactly 5,000 seats', () => {
    const exact = Array.from({ length: 50 }, (_, i) =>
      section({
        _id: i.toString(16).padStart(24, '0'),
        code: `S${i}`,
        x: 0,
        y: i * 2,
        rows: [row({ seats: 100 })],
      }),
    );
    expect(validateLayout(layout(exact))).toEqual([]);
  });

  it.each([
    ['DUPLICATE_ID', () => [section(), section({ code: 'B', x: 100 })]],
    ['DUPLICATE_CODE', () => [section(), section({ _id: 'c'.repeat(24), x: 100 })]],
    ['DUPLICATE_ROW', () => [section({ rows: [row(), row()] })]],
    ['UNKNOWN_TIER', () => [section({ rows: [row({ tierId: 'f'.repeat(24) })] })]],
    ['BAD_GAP', () => [section({ rows: [row({ gapsAfter: [4] })] })]],
    ['BAD_GAP', () => [section({ rows: [row({ gapsAfter: [1, 1] })] })]],
    ['BAD_BLOCKED', () => [section({ rows: [row({ blocked: [5] })] })]],
    ['BAD_BLOCKED', () => [section({ rows: [row({ blocked: [1, 1] })] })]],
    ['OUT_OF_BOUNDS', () => [section({ x: 399, rows: [row()] })]],
  ])('flags %s', (code, sections) => {
    expect(issueCodes(validateLayout(layout(sections())))).toContain(code);
  });

  it('points each issue at the right row', () => {
    const issues = validateLayout(
      layout([section({ rows: [row(), row({ label: 'B', tierId: 'f'.repeat(24) })] })]),
    );
    expect(issues[0]?.path).toEqual(['sections', 0, 'rows', 1, 'tierId']);
  });
});

describe('seatMapInputSchema', () => {
  it('a huge seat count fails fast, without reaching the generator', () => {
    const start = performance.now();
    const res = seatMapInputSchema.safeParse(
      layout([section({ rows: [row({ seats: 1_000_000_000 })] })]),
    );
    expect(res.success).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it.each([
    ['sections is not a list', { sections: 'nope' }],
    ['tiers is missing', { tiers: undefined }],
    ['a row is not an object', { sections: [section({ rows: [42] })] }],
    ['no tiers', { tiers: [] }],
    ['a bad id', { sections: [section({ _id: 'x' })] }],
  ])('a malformed layout is a normal error when %s', (_name, over) => {
    expect(seatMapInputSchema.safeParse(layout([section()], over)).success).toBe(false);
  });

  it('fills the defaults', () => {
    const parsed = seatMapInputSchema.parse({
      expectedRevision: 1,
      tiers: [tier],
      sections: [
        {
          _id: 'b'.repeat(24),
          name: 'Stalls',
          code: 'ST',
          x: 0,
          y: 0,
          rows: [{ label: 'A', seats: 2, tierId: tier._id }],
        },
      ],
    });
    expect(parsed.stageLabel).toBe('STAGE');
    expect(parsed.sections[0]).toMatchObject({ numbering: 'ltr' });
    expect(parsed.sections[0]!.rows[0]).toMatchObject({ offset: 0, gapsAfter: [], blocked: [] });
  });
});

describe('newId', () => {
  it('is 24 hex characters and unique', () => {
    expect(newId()).toMatch(/^[a-f0-9]{24}$/);
    expect(newId()).not.toBe(newId());
  });
});
