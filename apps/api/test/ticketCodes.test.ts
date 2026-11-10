import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { BOOKING_REFERENCE, MANUAL_CODE } from '@seatbook/shared';
import {
  bookingReference,
  formatManualCode,
  manualCode,
  normalizeManualCode,
  parseQr,
  qrCode,
  verifyQr,
} from '../src/lib/ticketCodes';

const ticket = new Types.ObjectId();
const event = new Types.ObjectId();

describe('ticket codes', () => {
  it('round-trips and verifies for the right event only', () => {
    const code = qrCode(ticket, event);
    expect(code).toMatch(/^SB1\.[\w-]{16}\.[\w-]{16}$/);
    const p = parseQr(code)!;
    expect(p.ticketId.equals(ticket)).toBe(true);
    expect(verifyQr(p, event)).toBe(true);
    expect(verifyQr(p, new Types.ObjectId())).toBe(false); // bound to the event
  });

  it('any tampering breaks the signature', () => {
    const code = qrCode(ticket, event);
    const last = code.at(-1) === 'A' ? 'B' : 'A';
    expect(verifyQr(parseQr(code.slice(0, -1) + last)!, event)).toBe(false);
  });

  it('malformed codes are rejected without any work', () => {
    expect(parseQr('hello')).toBeNull();
    expect(parseQr('SB2.' + 'a'.repeat(16) + '.' + 'b'.repeat(16))).toBeNull();
  });

  it('manual codes are 10 Crockford chars and forgiving to type', () => {
    const c = manualCode(ticket);
    expect(c).toMatch(MANUAL_CODE);
    const typed = `${c.slice(0, 4)}-${c.slice(4, 8)} ${c.slice(8)}`
      .toLowerCase()
      .replace(/0/g, 'o')
      .replace(/1/g, 'l');
    expect(normalizeManualCode(typed)).toBe(c);
    expect(normalizeManualCode(formatManualCode(c))).toBe(c);
    expect(normalizeManualCode('too-short')).toBeNull();
  });

  it('the same ticket always gets the same codes; another ticket gets others', () => {
    expect(manualCode(ticket)).toBe(manualCode(ticket));
    expect(qrCode(ticket, event)).toBe(qrCode(ticket, event));
    expect(manualCode(new Types.ObjectId())).not.toBe(manualCode(ticket));
  });

  it('booking references look like SB-XXXX-XXXX', () => {
    for (let i = 0; i < 50; i++) expect(bookingReference()).toMatch(BOOKING_REFERENCE);
  });
});
