import { ApiError } from '../api/client';

/**
 * No answer at all: the request may or may not have reached the server. A JSON error from the API
 * is an answer, even a 500. NETWORK_ERROR is what the client reports for a reply without our JSON
 * (a proxy's HTML error page, for one).
 */
export const isNetworkError = (err: unknown) =>
  !(err instanceof ApiError) || err.code === 'NETWORK_ERROR';

/**
 * Retries fn after the given delays (0.5 s, 1 s, 2 s: 3 retries, requirement §23.3). Only safe for
 * requests that are idempotent, like Pay with the same Idempotency-Key.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retryOn?: (err: unknown) => boolean; delaysMs?: number[] } = {},
): Promise<T> {
  const { retryOn = isNetworkError, delaysMs = [500, 1_000, 2_000] } = opts;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= delaysMs.length || !retryOn(err)) throw err;
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
  }
}
