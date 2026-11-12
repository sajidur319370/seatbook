/** Deterministic randomness for the seed: same seed number → the same demo, every time. */
export type Rand = () => number;

/** mulberry32: a tiny, good-enough PRNG returning [0, 1). */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const pick = <T>(xs: readonly T[], rand: Rand): T => xs[Math.floor(rand() * xs.length)]!;

type SeatLike = { sectionId: { toString(): string }; row: string; number: number };

/**
 * Takes n seats that sit together (same section and row, consecutive numbers) out of `free`, as
 * real groups of friends buy. Falls back to any n seats when no block that size is left.
 * `free` must be sorted by section, row, number.
 */
export function takeTogether<T extends SeatLike>(free: T[], n: number, rand: Rand): T[] {
  const starts: number[] = [];
  for (let i = 0; i + n <= free.length; i++) {
    const a = free[i]!;
    const b = free[i + n - 1]!;
    if (
      String(a.sectionId) === String(b.sectionId) &&
      a.row === b.row &&
      b.number - a.number === n - 1
    ) {
      starts.push(i);
    }
  }
  const at = starts.length ? pick(starts, rand) : Math.floor(rand() * Math.max(1, free.length - n));
  return free.splice(at, n);
}
