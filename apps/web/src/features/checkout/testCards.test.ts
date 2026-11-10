import { describe, expect, it } from 'vitest';
import { cardSchema, tokenFor } from './testCards';

const valid = { name: 'Rafi Ahmed', number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123' };

describe('test cards', () => {
  it('maps every test number to its token, however it is typed', () => {
    expect(tokenFor('4242 4242 4242 4242')).toBe('tok_visa');
    expect(tokenFor('4242424242424242')).toBe('tok_visa');
    expect(tokenFor('4000-0000-0000-0002')).toBe('tok_chargeDeclined');
    expect(tokenFor('4000 0000 0000 3220')).toBe('tok_slow');
    expect(tokenFor('1234 5678 9012 3456')).toBeUndefined();
  });

  it('accepts a complete test card', () => {
    expect(cardSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['a real-looking card', { number: '4111 1111 1111 1111' }, 'number'],
    ['month 13', { expiry: '13/28' }, 'expiry'],
    ['no slash', { expiry: '1228' }, 'expiry'],
    ['a short CVC', { cvc: '12' }, 'cvc'],
    ['a one-letter name', { name: 'R' }, 'name'],
  ])('rejects %s', (_name, over, field) => {
    const r = cardSchema.safeParse({ ...valid, ...over });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([field]);
  });
});
