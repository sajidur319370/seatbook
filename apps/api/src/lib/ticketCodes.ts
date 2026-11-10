import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import { CROCKFORD, MANUAL_CODE, TICKET_CODE_VERSION } from '@seatbook/shared';
import { env } from '../config/env';

/** queries.md §11 · requirement §13.1. Codes are derived from the ticket ID, never stored. */

export { sha256 } from './crypto';

const SIG_BYTES = 12;
const QR = /^SB1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{16})$/; // 12 bytes → 16 base64url chars

const mac = (msg: string) => createHmac('sha256', env.TICKET_SIGNING_SECRET).update(msg).digest();
const qrSignature = (ticketHex: string, eventHex: string) =>
  mac(`${TICKET_CODE_VERSION}.${ticketHex}.${eventHex}`).subarray(0, SIG_BYTES);

export function qrCode(ticketId: Types.ObjectId, eventId: Types.ObjectId): string {
  const hex = ticketId.toHexString();
  const id = Buffer.from(hex, 'hex').toString('base64url');
  return `${TICKET_CODE_VERSION}.${id}.${qrSignature(hex, eventId.toHexString()).toString('base64url')}`;
}

export function parseQr(code: string): { ticketId: Types.ObjectId; sig: Buffer } | null {
  const m = QR.exec(code.trim());
  if (!m) return null;
  return {
    ticketId: new Types.ObjectId(Buffer.from(m[1]!, 'base64url').toString('hex')),
    sig: Buffer.from(m[2]!, 'base64url'),
  };
}

/** Constant time: the response time doesn't reveal how many signature bytes matched. */
export function verifyQr(p: { ticketId: Types.ObjectId; sig: Buffer }, eventId: Types.ObjectId) {
  const expected = qrSignature(p.ticketId.toHexString(), eventId.toHexString());
  return p.sig.length === expected.length && timingSafeEqual(p.sig, expected);
}

function crockford(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; // 32-bit wrap is fine: only the last 12 bits are ever read
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function manualCode(ticketId: Types.ObjectId): string {
  return crockford(mac(`${TICKET_CODE_VERSION}.manual.${ticketId.toHexString()}`)).slice(0, 10);
}

export const formatManualCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;

/** Forgiving input: lower case, spaces, dashes, O→0, I/L→1 (Crockford rules). */
export function normalizeManualCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return MANUAL_CODE.test(c) ? c : null;
}

/** 40 random bits → 8 Crockford chars: SB-7KQ2-9XF3. */
export function bookingReference(): string {
  const c = crockford(randomBytes(5));
  return `SB-${c.slice(0, 4)}-${c.slice(4, 8)}`;
}
