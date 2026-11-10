import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { isNetworkError, withRetry } from './retry';

const fast = { delaysMs: [0, 0, 0] };
const declined = new ApiError(402, 'PAYMENT_DECLINED', 'Your card was declined.');

describe('withRetry', () => {
  it('returns the first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, fast)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries network errors, then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ApiError(502, 'NETWORK_ERROR', 'Request failed'))
      .mockResolvedValue('booked');
    await expect(withRetry(fn, fast)).resolves.toBe('booked');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries an answer from the API (a decline is final)', async () => {
    const fn = vi.fn().mockRejectedValue(declined);
    await expect(withRetry(fn, fast)).rejects.toBe(declined);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last delay: 1 try + 3 retries', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(withRetry(fn, fast)).rejects.toThrow('Failed to fetch');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('uses a custom rule when given one', async () => {
    const busy = new ApiError(409, 'CHECKOUT_IN_PROGRESS', 'busy');
    const fn = vi.fn().mockRejectedValueOnce(busy).mockResolvedValue('ok');
    const retryOn = (e: unknown) => e instanceof ApiError && e.code === 'CHECKOUT_IN_PROGRESS';
    await expect(withRetry(fn, { ...fast, retryOn })).resolves.toBe('ok');
  });
});

describe('isNetworkError', () => {
  it('is true only when there was no API answer', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new ApiError(502, 'NETWORK_ERROR', 'x'))).toBe(true);
    expect(isNetworkError(declined)).toBe(false);
    expect(isNetworkError(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(false);
  });
});
