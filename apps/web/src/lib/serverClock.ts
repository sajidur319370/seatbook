let offsetMs = 0;
let bestRoundTrip = Infinity;

/**
 * Call with the serverTime of a response and when the request was sent / received. The server
 * answered somewhere during the round trip, so a faster response says more about its clock. A slow
 * one (a free server waking up can take a minute) is ignored, unless it proves this device's clock
 * has changed since the last sample.
 */
export function syncServerClock(serverTimeIso: string, sentAt: number, receivedAt = Date.now()) {
  const roundTrip = receivedAt - sentAt;
  const midpoint = (sentAt + receivedAt) / 2; // assume the server answered halfway through
  const next = new Date(serverTimeIso).getTime() - midpoint;
  if (roundTrip > bestRoundTrip && Math.abs(next - offsetMs) <= roundTrip) return;
  bestRoundTrip = roundTrip;
  offsetMs = next;
}

/** Runs a request and learns the server's clock from its answer. */
export async function timed<T extends { serverTime: string }>(fn: () => Promise<T>): Promise<T> {
  const sentAt = Date.now();
  const res = await fn();
  syncServerClock(res.serverTime, sentAt);
  return res;
}

export const serverNow = () => Date.now() + offsetMs;
export const msUntil = (iso: string) => new Date(iso).getTime() - serverNow();
