/**
 * The demo (FR-UI-09, database.md §10), built through the REAL services on fake clocks:
 * publishEvent, addSeat, checkout, checkIn. If the seed works, the services work, and the data
 * obeys every invariant. Run it with scripts/seed.ts (safety checks, --reset); seed.test.ts runs
 * it on the in-memory database, so CI notices when a service change breaks the demo.
 */
import { randomUUID } from 'node:crypto';
import { fromZonedTime } from 'date-fns-tz';
import { Types } from 'mongoose';
import {
  concertHall,
  conferenceRoom,
  createEventSchema,
  newId,
  rowLabel,
  seatMapInputSchema,
  smallTheatre,
  type Role,
  type SeatMapInput,
} from '@seatbook/shared';
import { Seat, Ticket, User, type EventLean } from '../db/models';
import { addDays, calendarDays } from '../lib/dates';
import { AppError } from '../lib/errors';
import { qrCode } from '../lib/ticketCodes';
import { approveApplication } from '../modules/admin/admin.service';
import { apply } from '../modules/applications/application.service';
import { register } from '../modules/auth/auth.service';
import { checkIn } from '../modules/checkin/checkin.service';
import { checkout } from '../modules/checkout/checkout.service';
import { sweepOnce } from '../jobs/holdSweeper';
import { addSeat } from '../modules/holds/hold.service';
import { createEvent } from '../modules/organizer/event.service';
import { publishEvent } from '../modules/organizer/publish.service';
import { saveSeatMap } from '../modules/organizer/seatmap.service';
import { makeCtx, type Ctx } from '../types/ctx';
import { mulberry32, pick, takeTogether, type Rand } from './random';

const TZ = 'Asia/Dhaka';
export const DEMO = (local: string) => `${local}@demo.seatbook.dev`;
let password = ''; // set by seedDemo()

// ---------------------------------------------------------------- clocks and people

type Clock = { now: () => Date; set: (d: Date) => void; advance: (ms: number) => void };
/** One clock per event, moved FORWARD only: a hold made at 14:00 can't be paid at 13:00. */
function makeClock(start: Date): Clock {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    set: (d) => {
      if (d.getTime() < t) throw new Error(`clock moved backwards: ${d.toISOString()}`);
      t = d.getTime();
    },
    advance: (ms) => {
      t += ms;
    },
  };
}
/** A wall-clock time in Dhaka on a day 'YYYY-MM-DD' → instant. */
const dhaka = (day: string, minutes: number) =>
  fromZonedTime(
    `${day}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    TZ,
  );
const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
const MIN = 60_000;

type Person = { _id: Types.ObjectId; role: Role; name: string; email: string };
const ctxOf = (p: Person, now: () => Date): Ctx =>
  makeCtx({ userId: p._id, role: p.role, name: p.name, email: p.email, now });

async function person(local: string, name: string): Promise<Person> {
  const email = DEMO(local);
  await register({ name, email, password }, { ip: '127.0.0.1', userAgent: 'seed' });
  await User.updateOne({ email }, { $set: { timezone: TZ } });
  const u = (await User.findOne({ email }).select('_id role name email').lean())!;
  return { _id: u._id, role: u.role as Role, name: u.name, email: u.email };
}

async function seedPeople() {
  const admin = await person('admin', 'Arif Admin');
  await User.updateOne({ _id: admin._id }, { $set: { role: 'admin' } }); // what make-admin does
  admin.role = 'admin';

  // The organizer goes through the real application flow (FR-APP), approved by the admin.
  const organizer = await person('organizer', 'Nadia Rahman');
  const now = () => new Date();
  const app = await apply(ctxOf(organizer, now), {
    organizationName: 'Dhaka Live Productions',
    website: 'https://example.com',
    message: 'We run theatre, jazz and conference nights across Dhaka every month.',
  });
  await approveApplication(ctxOf(admin, now), app._id);
  organizer.role = 'organizer';

  const attendee = await person('attendee', 'Rafi Ahmed');
  const attendee2 = await person('attendee2', 'Mina Chowdhury');
  const applicant = await person('applicant', 'Karim Hossain');
  await apply(ctxOf(applicant, now), {
    organizationName: 'Karim Comedy Club',
    website: null,
    message: 'Weekly stand-up nights in Gulshan, about 150 seats each, since 2024.',
  });

  const buyers: Person[] = [];
  for (let i = 1; i <= 40; i++) {
    buyers.push(await person(`buyer${String(i).padStart(2, '0')}`, `Demo Buyer ${i}`));
  }
  return { admin, organizer, attendee, attendee2, applicant, buyers };
}
type People = Awaited<ReturnType<typeof seedPeople>>;

// ---------------------------------------------------------------- events

type Layout = Omit<SeatMapInput, 'expectedRevision'>;
type Details = { title: string; summary: string; category: string; venue: object } & Record<
  string,
  unknown
>;

/** Create, lay out and publish an event at the clock's current moment, through the services. */
async function publishAt(org: Person, clock: Clock, details: Details, layout: Layout) {
  const ctx = ctxOf(org, clock.now);
  const draft = await createEvent(
    ctx,
    createEventSchema.parse({ timezone: TZ, currency: 'BDT', maxSeatsPerOrder: 8, ...details }),
  );
  await saveSeatMap(
    ctx,
    draft._id,
    seatMapInputSchema.parse({ ...layout, expectedRevision: draft.revision }),
  );
  return publishEvent(ctx, draft._id);
}

/**
 * Sells `share` of the free seats between two days, in groups of 1–4 sitting together, at
 * random daytime moments in Dhaka: busier on the first day and the last two.
 */
async function sellOver(
  ev: EventLean,
  buyers: Person[],
  clock: Clock,
  o: { from: string; to: string; share: number },
  rand: Rand,
) {
  const free = await Seat.find({ eventId: ev._id, status: 'available' })
    .sort({ sectionId: 1, row: 1, number: 1 })
    .lean();
  let left = Math.round(free.length * o.share);
  const days = calendarDays(o.from, o.to);
  for (const [i, day] of days.entries()) {
    const weight = i === 0 || i >= days.length - 2 ? 2 : 1;
    let today = Math.min(
      left,
      Math.round((left / (days.length - i)) * weight * (0.6 + rand() * 0.8)),
    );
    if (i === days.length - 1) today = left; // whatever is left goes on the last day
    const minutes = Array.from({ length: Math.ceil(today / 2.5) + 1 }, () =>
      Math.floor(9 * 60 + rand() * (14 * 60 + 30)),
    ).sort((a, b) => a - b);
    for (const minute of minutes) {
      if (today <= 0) break;
      const when = dhaka(day, minute);
      if (when < clock.now()) continue; // the publish moment on day one
      const seats = takeTogether(free, Math.min(today, 1 + Math.floor(rand() * 4)), rand);
      if (!seats.length) break;
      clock.set(when);
      await buy(
        pick(buyers, rand),
        clock,
        ev._id,
        seats.map((s) => s._id),
      );
      today -= seats.length;
      left -= seats.length;
    }
  }
}

/**
 * Hold the seats, then pay. MongoDB's TTL monitor deletes holds an hour after `expiresAt` by the
 * REAL clock, and every backdated hold is already "days expired" to it: once a minute it can delete
 * the one being paid for (→ SEATS_LOST, refunded). Live traffic never meets this, since checkout
 * needs an unexpired hold. Here: let the deleted hold's seats expire (+11 min, past the 10-minute
 * hold they still carry) and buy them again.
 */
async function buy(
  buyer: Person,
  clock: Clock,
  eventId: Types.ObjectId,
  seatIds: Types.ObjectId[],
) {
  const RETRYABLE = ['SEATS_LOST', 'HOLD_EXPIRED', 'NOT_FOUND', 'HOLD_EMPTY', 'SEAT_UNAVAILABLE'];
  let wanted = seatIds.map(String);
  for (let attempt = 1; wanted.length; attempt++) {
    const ctx = ctxOf(buyer, clock.now);
    try {
      for (const id of wanted) await addSeat(ctx, eventId, new Types.ObjectId(id));
      const { booking } = await checkout(ctx, eventId, { paymentToken: 'tok_visa' }, randomUUID());
      // A hold deleted BETWEEN two clicks leaves the first seat on the dead hold, and the checkout
      // quietly sells only the rest. Buy whatever is missing again.
      const bought = new Set(booking.items.map((i) => i.seatId));
      wanted = wanted.filter((id) => !bought.has(id));
    } catch (err) {
      const code = err instanceof AppError ? err.code : '';
      if (!RETRYABLE.includes(code)) throw err;
    }
    if (!wanted.length) return;
    if (attempt >= 3) throw new Error(`seed: could not buy ${wanted.length} seat(s) after 3 tries`);
    clock.advance(11 * MIN); // past the orphaned seats' 10-minute hold: they're free again
  }
}

/** Seats next to each other that are still free, for a named demo account. */
async function freeSeats(eventId: Types.ObjectId, n: number, rand: Rand) {
  const free = await Seat.find({ eventId, status: 'available' })
    .sort({ sectionId: 1, row: 1, number: 1 })
    .lean();
  return takeTogether(free, n, rand).map((s) => s._id);
}

const venue = (name: string) => ({ name, address: '', city: 'Dhaka' });
const today = () => dayOf(new Date());
const dayAt = (offsetDays: number) => dayOf(addDays(new Date(), offsetDays));

/** Hamlet: 552 seats, on sale for 10 days, ~40 % sold; the attendee holds 2 tickets. */
async function seedHamlet(p: People, rand: Rand) {
  const clock = makeClock(dhaka(dayAt(-10), 9 * 60));
  const startsAt = dhaka(dayAt(12), 19 * 60);
  const ev = await publishAt(
    p.organizer,
    clock,
    {
      title: 'Hamlet — Evening Show',
      summary: 'Shakespeare’s tragedy in a new Bangla-English staging.',
      category: 'theatre',
      venue: venue('Shilpakala Main Hall'),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(+startsAt + 3 * 60 * MIN).toISOString(),
    },
    concertHall(),
  );
  await sellOver(ev, p.buyers, clock, { from: dayAt(-10), to: dayAt(-1), share: 0.4 }, rand);
  clock.advance(5 * MIN);
  await buy(p.attendee, clock, ev._id, await freeSeats(ev._id, 2, rand));
  return ev;
}

/** Jazz: 120 seats, ~93 % sold: the "last seats" demo. */
async function seedJazz(p: People, rand: Rand) {
  const clock = makeClock(dhaka(dayAt(-14), 9 * 60));
  const startsAt = dhaka(dayAt(5), 20 * 60);
  const ev = await publishAt(
    p.organizer,
    clock,
    {
      title: 'Jazz Night at the Rooftop',
      summary: 'A quartet, the city lights, and 120 seats.',
      category: 'concert',
      venue: venue('Skyline Rooftop, Banani'),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(+startsAt + 3 * 60 * MIN).toISOString(),
    },
    smallTheatre(),
  );
  await sellOver(ev, p.buyers, clock, { from: dayAt(-14), to: dayAt(-1), share: 0.93 }, rand);
  return ev;
}

/** 300 seats: 3 rooms × 10 rows × 10, for the conference. */
function conference300(): Layout {
  const base = conferenceRoom();
  const tier = base.tiers[0]!;
  return {
    ...base,
    tiers: [tier],
    sections: ['A', 'B', 'C'].map((code, i) => ({
      _id: newId(),
      name: `Hall ${code}`,
      code,
      x: i * 14,
      y: 0,
      numbering: 'ltr' as const,
      rows: Array.from({ length: 10 }, (_, r) => ({
        label: rowLabel(r),
        seats: 10,
        offset: 0,
        tierId: tier._id,
        gapsAfter: [],
        blocked: [],
      })),
    })),
  };
}

/** DevConf: ended 3 days ago, 90 % sold, 85 % checked in, some duplicates and junk scans. */
async function seedDevConf(p: People, rand: Rand) {
  const startsAt = dhaka(dayAt(-3), 10 * 60);
  const clock = makeClock(dhaka(dayOf(addDays(startsAt, -30)), 9 * 60));
  const ev = await publishAt(
    p.organizer,
    clock,
    {
      title: 'DevConf Dhaka 2026',
      summary: 'A day of talks on web, data and cloud.',
      category: 'conference',
      venue: venue('Bangabandhu Convention Centre'),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(+startsAt + 8 * 60 * MIN).toISOString(),
    },
    conference300(),
  );
  await sellOver(
    ev,
    p.buyers,
    clock,
    { from: dayOf(clock.now()), to: dayOf(addDays(startsAt, -1)), share: 0.9 },
    rand,
  );
  clock.advance(5 * MIN);
  await buy(p.attendee, clock, ev._id, await freeSeats(ev._id, 1, rand));

  // Event day: 85 % of tickets scanned from 60 min before the start to 30 min after.
  const org = ctxOf(p.organizer, clock.now);
  const tickets = await Ticket.find({ eventId: ev._id, status: 'issued' })
    .select('_id eventId userId')
    .lean();
  const attendeeTicket = tickets.find((t) => t.userId.equals(p.attendee._id))!;
  const others = tickets.filter((t) => t !== attendeeTicket).sort(() => rand() - 0.5);
  const toScan = [attendeeTicket, ...others.slice(0, Math.round(tickets.length * 0.85) - 1)];
  const times = toScan
    .map(() => +startsAt - 60 * MIN + Math.floor(rand() * 90 * MIN))
    .sort((a, b) => a - b);
  for (const [i, t] of toScan.entries()) {
    clock.set(new Date(times[i]!));
    await checkIn(org, ev, {
      code: qrCode(t._id, t.eventId),
      method: 'qr',
      gate: i % 2 ? 'Gate 2' : 'Gate 1',
    });
  }
  // Four screenshots shown twice, and two codes that were never tickets.
  for (const t of toScan.slice(0, 4)) {
    clock.advance(2 * MIN);
    await checkIn(org, ev, { code: qrCode(t._id, t.eventId), method: 'qr', gate: 'Gate 1' });
  }
  for (const junk of ['SB1.not-a-real-ticket', 'hello']) {
    clock.advance(MIN);
    await checkIn(org, ev, { code: junk, method: 'qr', gate: 'Gate 2' });
  }
  return ev;
}

/** Comedy: a draft with a half-built map, for the builder demo. */
async function seedComedyDraft(p: People) {
  const ctx = ctxOf(p.organizer, () => new Date());
  const startsAt = dhaka(dayAt(20), 21 * 60);
  const draft = await createEvent(
    ctx,
    createEventSchema.parse({
      title: 'Stand-up Comedy Hour',
      summary: 'Five comics, one mic. Seat map still in progress.',
      category: 'comedy',
      venue: venue('Gulshan Club Hall'),
      timezone: TZ,
      currency: 'BDT',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(+startsAt + 90 * MIN).toISOString(),
    }),
  );
  const half = smallTheatre();
  half.sections[0]!.rows = half.sections[0]!.rows.slice(0, 4);
  await saveSeatMap(
    ctx,
    draft._id,
    seatMapInputSchema.parse({ ...half, expectedRevision: draft.revision }),
  );
}

/** Symphony (--big): 5,000 seats, sales open in 3 days (the performance demo). */
async function seedSymphony(p: People) {
  const tier = (name: string, price: number, color: 'purple' | 'teal' | 'amber') => ({
    _id: newId(),
    name,
    price,
    color,
  });
  const tiers = [
    tier('Floor', 900_000, 'purple'),
    tier('Lower', 600_000, 'teal'),
    tier('Upper', 300_000, 'amber'),
  ];
  const sections = Array.from({ length: 10 }, (_, i) => ({
    _id: newId(),
    name: `Block ${i + 1}`,
    code: `B${i + 1}`,
    x: (i % 5) * 24,
    y: Math.floor(i / 5) * 28,
    numbering: 'ltr' as const,
    rows: Array.from({ length: 25 }, (_, r) => ({
      label: rowLabel(r),
      seats: 20,
      offset: 0,
      tierId: tiers[Math.min(2, Math.floor(r / 9))]!._id,
      gapsAfter: [10],
      blocked: [],
    })),
  })); // 10 × 25 × 20 = 5,000
  const startsAt = dhaka(dayAt(40), 19 * 60);
  await publishAt(
    p.organizer,
    makeClock(new Date()),
    {
      title: 'Symphony Under the Stars',
      summary: 'The national orchestra in the open air: 5,000 seats.',
      category: 'concert',
      venue: venue('National Parade Ground'),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(+startsAt + 3 * 60 * MIN).toISOString(),
      salesStartAt: dhaka(dayAt(3), 10 * 60).toISOString(),
    },
    { stageLabel: 'STAGE', tiers, sections },
  );
}

/** Builds the whole demo into the connected database (which should be empty). */
export async function seedDemo(o: { password: string; big?: boolean; log?: (s: string) => void }) {
  const log = o.log ?? (() => {});
  password = o.password;
  const rand = mulberry32(20261026); // same seed → same demo, every time
  const people = await seedPeople();
  log('· people');
  const hamlet = await seedHamlet(people, rand);
  log('· Hamlet');
  const jazz = await seedJazz(people, rand);
  log('· Jazz');
  const devconf = await seedDevConf(people, rand);
  log('· DevConf');
  await seedComedyDraft(people);
  if (o.big) {
    await seedSymphony(people);
    log('· Symphony (5,000 seats)');
  }
  // Seats a TTL-deleted hold left behind are free by lazy expiry already; one sweep makes it
  // explicit, as a running server's sweeper would within 5 s (database.md §10).
  await sweepOnce(new Date(), 'seed');
  return { people, events: { hamlet: hamlet._id, jazz: jazz._id, devconf: devconf._id } };
}

export const seedToday = () => today();
