import type { Types } from 'mongoose';
import type {
  CheckInInput,
  CheckInResponse,
  CheckinTicketDto,
  ScanDto,
  ScanFeedResponse,
  ScanResult,
} from '@seatbook/shared';
import { Scan, Ticket, User, type ScanLean, type TicketLean } from '../../db/models';
import { publish } from '../../events/publish';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { normalizeManualCode, parseQr, sha256, verifyQr } from '../../lib/ticketCodes';
import type { Ctx } from '../../types/ctx';
import type { OwnedEventLean } from '../events/scope';

/** queries.md §13. Codes are only ever compared, never stored or logged (FR-TKT-09). */

type Resolved = { ticketId: Types.ObjectId } | { result: 'invalid' | 'wrong_event' | 'not_found' };

/**
 * §13.1. A camera scan only takes the QR path, so anything that isn't a well-formed SB1 code is
 * `invalid` without a database read (AC-TKT-02). A typed code may still be a pasted QR string.
 */
export async function resolveCode(
  eventId: Types.ObjectId,
  code: string,
  method: 'qr' | 'manual',
): Promise<Resolved> {
  const parsed = parseQr(code);
  if (parsed) {
    if (verifyQr(parsed, eventId)) return { ticketId: parsed.ticketId }; // no DB read so far
    // Not signed for THIS event. Only say "wrong_event" if it's genuinely signed for the ticket's
    // own event: a forger probing with random ids learns nothing (no oracle).
    const other = await Ticket.findOne({ _id: parsed.ticketId })
      .select('eventId')
      .lean<Pick<TicketLean, 'eventId'>>();
    return { result: other && verifyQr(parsed, other.eventId) ? 'wrong_event' : 'invalid' };
  }
  if (method === 'qr') return { result: 'invalid' };

  const manual = normalizeManualCode(code);
  if (!manual) return { result: 'invalid' }; // malformed: no DB read
  const t = await Ticket.findOne({ eventId, manualCodeHash: sha256(manual) }) // AP16
    .select('_id')
    .lean<Pick<TicketLean, '_id'>>();
  return t ? { ticketId: t._id } : { result: 'not_found' };
}

/** FR-CHK-08 (Should): from 6 h before the start until 2 h after the end. */
export function withinCheckinWindow(ev: { startsAt: Date; endsAt: Date }, now: Date) {
  const t = now.getTime();
  return t >= ev.startsAt.getTime() - 6 * 3_600_000 && t <= ev.endsAt.getTime() + 2 * 3_600_000;
}

const CHECKIN_FIELDS =
  '_id seatLabel sectionName row number tierName holderName status checkedInAt checkedInBy';
type CheckinRow = Pick<
  TicketLean,
  | '_id'
  | 'seatLabel'
  | 'sectionName'
  | 'row'
  | 'number'
  | 'tierName'
  | 'holderName'
  | 'status'
  | 'checkedInAt'
  | 'checkedInBy'
>;

const toCheckinTicketDto = (t: CheckinRow, extra: Partial<CheckinTicketDto> = {}) => ({
  id: String(t._id),
  seatLabel: t.seatLabel,
  sectionName: t.sectionName,
  row: t.row,
  number: t.number,
  tierName: t.tierName,
  holderName: t.holderName,
  checkedInAt: t.checkedInAt ? t.checkedInAt.toISOString() : null,
  ...extra,
});

/** "Already used at 19:42 by Nadia (Gate 2)": who let it in, and where. Only on a second scan. */
async function firstEntry(t: CheckinRow): Promise<Partial<CheckinTicketDto>> {
  const [by, scan] = await Promise.all([
    t.checkedInBy ? User.findOne({ _id: t.checkedInBy }).select('name').lean() : null,
    Scan.findOne({ ticketId: t._id, result: 'ok' }).sort({ createdAt: -1 }).select('gate').lean(),
  ]);
  return { checkedInByName: by?.name, checkedInGate: scan?.gate ?? null };
}

/** §13.2. The event comes from the route's ownership check, so another organizer never gets here. */
export async function checkIn(
  ctx: Ctx,
  ev: Pick<OwnedEventLean, '_id' | 'startsAt' | 'endsAt'>,
  input: CheckInInput,
): Promise<CheckInResponse> {
  const now = ctx.now();
  const r = await resolveCode(ev._id, input.code, input.method);

  let result: ScanResult;
  let ticket: CheckinTicketDto | null = null;

  if ('result' in r) {
    result = r.result;
  } else if (!withinCheckinWindow(ev, now)) {
    result = 'outside_window';
  } else {
    // THE single-use switch (I11): one document, one atomic write. Two gates at once → one match.
    const won = await Ticket.findOneAndUpdate(
      { _id: r.ticketId, eventId: ev._id, status: 'issued' },
      { $set: { status: 'checked_in', checkedInAt: now, checkedInBy: ctx.userId } },
      { new: true, projection: CHECKIN_FIELDS },
    ).lean<CheckinRow>();

    if (won) {
      result = 'ok';
      ticket = toCheckinTicketDto(won, {
        checkedInByName: ctx.name,
        checkedInGate: input.gate ?? null,
      });
    } else {
      const t = await Ticket.findOne({ _id: r.ticketId, eventId: ev._id })
        .select(CHECKIN_FIELDS)
        .lean<CheckinRow>();
      if (!t) {
        result = 'not_found';
      } else if (t.status === 'checked_in') {
        result = 'already_checked_in'; // E17: the screenshot shared with five friends
        ticket = toCheckinTicketDto(t, await firstEntry(t));
      } else {
        result = 'void';
        ticket = toCheckinTicketDto(t);
      }
    }
  }

  // FR-CHK-06: every attempt, with the ticket it resolved to. Never the code.
  await Scan.create({
    eventId: ev._id,
    ticketId: 'ticketId' in r ? r.ticketId : null,
    result,
    method: input.method,
    gate: input.gate || null,
    scannedBy: ctx.userId,
    createdAt: now, // the injectable clock (see checkout's booking createdAt)
  });

  const [checkedIn, sold] = await Promise.all([
    Ticket.countDocuments({ eventId: ev._id, status: 'checked_in' }), // index { eventId, status }
    Ticket.countDocuments({ eventId: ev._id, status: { $in: ['issued', 'checked_in'] } }),
  ]);
  const counts = { checkedIn, sold };

  // publish() bumps counters.ticketsCheckedIn on 'ok' (events/counters.ts), then tells every gate.
  await publish(ctx, [
    { type: 'checkin.recorded', eventId: ev._id, result, ticket, counts, at: now },
  ]);
  return { result, ticket, counts };
}

const FEED_PAGE = 50;

/** §13.4 (AP17): newest first, optional filter by result, seat labels in ONE extra query. */
export async function scanFeed(
  eventId: Types.ObjectId,
  q: { result?: ScanResult; cursor?: string },
): Promise<ScanFeedResponse> {
  const filter: Record<string, unknown> = { eventId };
  if (q.result) filter.result = q.result;
  if (q.cursor) {
    const { t, id } = decodeCursor(q.cursor);
    filter.$or = [{ createdAt: { $lt: t } }, { createdAt: t, _id: { $lt: id } }];
  }
  const rows = await Scan.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(FEED_PAGE + 1)
    .lean<ScanLean[]>();
  const page = rows.slice(0, FEED_PAGE);

  const ids = [...new Set(page.filter((s) => s.ticketId).map((s) => String(s.ticketId)))];
  const tickets = await Ticket.find({ _id: { $in: ids }, eventId })
    .select('seatLabel holderName')
    .lean<Pick<TicketLean, '_id' | 'seatLabel' | 'holderName'>[]>();
  const byId = new Map(tickets.map((t) => [String(t._id), t]));

  return {
    items: page.map((s): ScanDto => {
      const t = s.ticketId ? byId.get(String(s.ticketId)) : undefined;
      return {
        id: String(s._id),
        result: s.result as ScanResult,
        method: s.method as ScanDto['method'],
        gate: s.gate ?? null,
        createdAt: s.createdAt.toISOString(),
        seatLabel: t?.seatLabel ?? null,
        holderName: t?.holderName ?? null,
      };
    }),
    nextCursor: rows.length > FEED_PAGE ? encodeCursor(page.at(-1)!) : null,
  };
}
