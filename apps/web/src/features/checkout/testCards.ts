import { z } from 'zod';
import type { PaymentToken } from '@seatbook/shared';

/** requirement §12.1. The UI maps the typed number to a token: no card data reaches the server. */
export const TEST_CARDS: { number: string; token: PaymentToken; result: string }[] = [
  { number: '4242 4242 4242 4242', token: 'tok_visa', result: 'Success (Visa)' },
  { number: '5555 5555 5555 4444', token: 'tok_mastercard', result: 'Success (Mastercard)' },
  { number: '4000 0000 0000 0002', token: 'tok_chargeDeclined', result: 'Declined' },
  { number: '4000 0000 0000 3220', token: 'tok_slow', result: 'Success after 3 s' },
  { number: '4000 0000 0000 0119', token: 'tok_providerError', result: 'Provider error' },
];

const digits = (s: string) => s.replace(/\D/g, '');
const TOKEN_BY_NUMBER = new Map(TEST_CARDS.map((c) => [digits(c.number), c.token]));

/** The token for a typed number ("4242 4242…", "4242-4242…"), or undefined if it isn't a test card. */
export const tokenFor = (number: string) => TOKEN_BY_NUMBER.get(digits(number));

/**
 * Name, expiry and CVC are checked so the form feels real, then dropped: only the token leaves the
 * browser (requirement A-6).
 */
export const cardSchema = z.object({
  name: z.string().trim().min(2, 'Name on card'),
  number: z.string().refine((n) => !!tokenFor(n), 'Use one of the test cards (see "Test cards")'),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'MM/YY'),
  cvc: z.string().regex(/^\d{3,4}$/, '3–4 digits'),
});
export type CardInput = z.infer<typeof cardSchema>;
