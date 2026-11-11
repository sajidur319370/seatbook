/**
 * Decides which camera reads become check-in requests (FR-CHK-09's 1.5 s cooldown per code).
 *
 * The cooldown counts from the last time the code was SEEN, not the last time it was sent. The
 * camera reports a visible code several times a second, so a ticket held up for a few seconds is
 * sent once, instead of turning "Welcome" into "Already used". Out of view for 1.5 s, it counts as
 * shown again: the screenshot passed to a friend (E17) still gets "Already used".
 */
export function createScanGate(quietMs = 1_500) {
  let last: { code: string; seenAt: number } | null = null;
  return {
    /** A frame with `code` in view. True when it should be sent to the server. */
    seen(code: string, now: number): boolean {
      const repeat = last?.code === code && now - last.seenAt < quietMs;
      last = { code, seenAt: now };
      return !repeat;
    },
    /**
     * The scanner was paused (a request in flight) and is running again. It saw nothing meanwhile,
     * so count the last code as seen just now. A slow answer mustn't make it "new" again.
     */
    resumed(now: number) {
      if (last) last = { ...last, seenAt: now };
    },
  };
}
