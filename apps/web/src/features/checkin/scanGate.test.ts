import { describe, expect, it } from 'vitest';
import { createScanGate } from './scanGate';

/** Frames every `step` ms from `from` to `to`; returns the times at which the gate let one through. */
function hold(
  gate: ReturnType<typeof createScanGate>,
  code: string,
  from: number,
  to: number,
  step = 300,
) {
  const sent: number[] = [];
  for (let t = from; t <= to; t += step) if (gate.seen(code, t)) sent.push(t);
  return sent;
}

describe('scan gate', () => {
  it('a ticket held in view for 10 s is sent once', () => {
    expect(hold(createScanGate(), 'A', 0, 10_000)).toEqual([0]);
  });

  it('shown again after 1.5 s out of view, it is sent again (a screenshot, E17)', () => {
    const gate = createScanGate();
    expect(hold(gate, 'A', 0, 900)).toEqual([0]);
    expect(gate.seen('A', 900 + 1_600)).toBe(true);
  });

  it('a short glance away (under 1.5 s) is still the same showing', () => {
    const gate = createScanGate();
    gate.seen('A', 0);
    expect(gate.seen('A', 1_200)).toBe(false);
  });

  it('a different ticket goes through at once', () => {
    const gate = createScanGate();
    gate.seen('A', 0);
    expect(gate.seen('B', 100)).toBe(true);
    expect(gate.seen('A', 200)).toBe(true); // A after B: someone else's turn
  });

  it('a slow answer (scanner paused for 3 s) does not make the held ticket new again', () => {
    const gate = createScanGate();
    gate.seen('A', 0); // sent; the scanner pauses until the answer arrives
    gate.resumed(3_000);
    expect(gate.seen('A', 3_300)).toBe(false);
  });
});
