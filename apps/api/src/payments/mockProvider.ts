import { setTimeout as sleep } from 'node:timers/promises';
import type { PaymentToken } from '@seatbook/shared';
import { env } from '../config/env';
import { sha256 } from '../lib/crypto';
import { logger } from '../lib/logger';

/** queries.md §10.3. Test cards: requirement §12.1. */

export class PaymentDeclined extends Error {}
export class PaymentProviderError extends Error {}

const BRAND: Partial<Record<PaymentToken, { brand: string; last4: string }>> = {
  tok_visa: { brand: 'visa', last4: '4242' },
  tok_mastercard: { brand: 'mastercard', last4: '4444' },
  tok_slow: { brand: 'visa', last4: '3220' },
};

const SLOW_MS = env.NODE_ENV === 'test' ? 1_500 : 3_000;

/**
 * One object, not named exports, so tests can spy on it: vi.spyOn can't replace an ESM named export.
 * The service must call payments.charge(...), never a destructured charge.
 */
export const payments = {
  async charge(p: {
    amount: number;
    currency: string;
    token: PaymentToken;
    idempotencyKey: string;
  }) {
    await sleep(p.token === 'tok_slow' ? SLOW_MS : 300); // feels like a network call
    if (p.token === 'tok_chargeDeclined') throw new PaymentDeclined();
    if (p.token === 'tok_providerError') throw new PaymentProviderError();
    // Same key → same charge id: a retried charge is the SAME charge (like Stripe's Idempotency-Key).
    const chargeId = 'ch_mock_' + sha256(p.idempotencyKey).slice(0, 24);
    logger.info({ chargeId, amount: p.amount, currency: p.currency }, 'checkout.charged');
    const card = BRAND[p.token] ?? { brand: null, last4: null };
    return { chargeId, ...card, amount: p.amount, paidAt: new Date() };
  },

  async refund(chargeId: string) {
    logger.warn({ chargeId }, 'checkout.refunded');
    return { refundId: 're_mock_' + sha256(chargeId).slice(0, 24), refundedAt: new Date() };
  },
};

export type Charge = Awaited<ReturnType<typeof payments.charge>>;
