/**
 * FR-DASH-08: dashboard p95 < 500 ms for an event with 5,000 tickets and 20,000 scans.
 *   npm run bench:dashboard            (uses MONGODB_URI from apps/api/.env)
 * Builds synthetic data in a SEPARATE database (seatbook_bench), times eventDashboard(), then drops
 * that database. Your real data is never touched.
 */
import { randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { env } from '../src/config/env';
import { connectDb, disconnectDb } from '../src/db/connection';
import { syncAllIndexes } from '../src/db/indexes';
import { Booking, Event, Scan, Seat, Ticket } from '../src/db/models';
import { eventDashboard, type DashboardEvent } from '../src/modules/dashboard/dashboard.service';

const url = new URL(env.MONGODB_URI);
url.pathname = '/seatbook_bench';
await connectDb(url.toString());
if (mongoose.connection.db?.databaseName !== 'seatbook_bench') throw new Error('wrong database');
await mongoose.connection.db.dropDatabase(); // a leftover from an aborted run
await syncAllIndexes(); // the indexes the $match stages rely on

const now = new Date();
const H = 3_600_000;
const D = 24 * H;
const oid = () => new Types.ObjectId();
const rnd = (n: number) => Math.floor(Math.random() * n);
const inBatches = async <T>(docs: T[], insert: (b: T[]) => Promise<unknown>) => {
  for (let i = 0; i < docs.length; i += 1_000) await insert(docs.slice(i, i + 1_000));
};

// 1. A published event that started 1 h ago: 3 tiers, 5,000 sellable seats.
const tiers = [
  { _id: oid(), name: 'Floor', price: 900_000, color: 'purple' },
  { _id: oid(), name: 'Lower', price: 600_000, color: 'teal' },
  { _id: oid(), name: 'Upper', price: 300_000, color: 'amber' },
];
const eventId = oid();
await Event.collection.insertOne({
  _id: eventId,
  organizerId: oid(),
  title: 'Bench Arena',
  slug: 'bench-arena',
  status: 'published',
  timezone: 'Asia/Dhaka',
  currency: 'BDT',
  venue: { name: 'Bench', city: 'Dhaka' },
  startsAt: new Date(+now - H),
  endsAt: new Date(+now + 2 * H),
  publishedAt: new Date(+now - 30 * D),
  salesStartAt: new Date(+now - 30 * D),
  salesEndAt: null,
  tiers,
  seatMap: { sections: [] },
  counters: {
    seatsTotal: 5_000,
    seatsSellable: 5_000,
    seatsSold: 5_000,
    ticketsCheckedIn: 4_000,
    revenue: 0,
  },
});

// 2. 5,000 seats; 1,250 bookings × 4 tickets over 30 days; 80 % checked in over 2 hours.
const sectionId = oid();
const seats = Array.from({ length: 5_000 }, (_, i) => {
  const tier = tiers[i % 3]!;
  return {
    _id: oid(),
    eventId,
    sectionId,
    row: `R${Math.floor(i / 100)}`,
    number: (i % 100) + 1,
    label: `S-R${Math.floor(i / 100)}-${(i % 100) + 1}`,
    tierId: tier._id,
    price: tier.price,
    x: i % 100,
    y: Math.floor(i / 100),
    status: 'booked',
    holdId: null,
    heldBy: null,
    holdExpiresAt: null,
    bookingId: null as Types.ObjectId | null,
    version: 2,
  };
});
const bookings: Record<string, unknown>[] = [];
const tickets: (Record<string, unknown> & { _id: Types.ObjectId })[] = [];
for (let b = 0; b < 1_250; b++) {
  const bookingId = oid();
  const mine = seats.slice(b * 4, b * 4 + 4);
  for (const s of mine) s.bookingId = bookingId;
  bookings.push({
    _id: bookingId,
    reference: `SB-${b}`,
    userId: oid(),
    eventId,
    holdId: oid(),
    idempotencyKey: randomBytes(8).toString('hex'),
    currency: 'BDT',
    status: 'confirmed',
    items: mine.map((s) => ({ seatId: s._id, label: s.label, price: s.price })),
    total: mine.reduce((n, s) => n + s.price, 0),
    createdAt: new Date(+now - 30 * D + rnd(30 * D)),
  });
  for (const s of mine) {
    const checked = Math.random() < 0.8;
    tickets.push({
      _id: oid(),
      eventId,
      bookingId,
      userId: oid(),
      seatId: s._id,
      seatKey: s._id,
      seatLabel: s.label,
      tierId: s.tierId,
      price: s.price,
      status: checked ? 'checked_in' : 'issued',
      checkedInAt: checked ? new Date(+now - 2 * H + rnd(2 * H)) : null,
      manualCodeHash: randomBytes(16).toString('hex'),
    });
  }
}
await inBatches(seats, (b) => Seat.collection.insertMany(b));
await inBatches(bookings, (b) => Booking.collection.insertMany(b));
await inBatches(tickets, (b) => Ticket.collection.insertMany(b));

// 3. 20,000 scans, 10 % duplicates.
const scans = Array.from({ length: 20_000 }, (_, i) => ({
  eventId,
  ticketId: tickets[i % tickets.length]!._id,
  method: 'qr',
  scannedBy: oid(),
  result: Math.random() < 0.1 ? 'already_checked_in' : 'ok',
  createdAt: new Date(+now - rnd(2 * H)),
}));
await inBatches(scans, (b) => Scan.collection.insertMany(b));

// 4. Warm up 3 times, then time 30 runs.
const ev = (await Event.findOne({ _id: eventId }).lean()) as unknown as DashboardEvent;
for (let i = 0; i < 3; i++) await eventDashboard(ev, new Date());
const ms: number[] = [];
let last;
for (let i = 0; i < 30; i++) {
  const t0 = performance.now();
  last = await eventDashboard(ev, new Date());
  ms.push(performance.now() - t0);
}
ms.sort((a, b) => a - b);
const p = (q: number) => ms[Math.min(ms.length - 1, Math.ceil(q * ms.length) - 1)]!.toFixed(1);
console.log(`data: ${tickets.length} tickets, ${scans.length} scans, ${bookings.length} bookings`);
console.log(
  `sanity: sold ${last!.kpi.sold}, checked in ${last!.kpi.checkedIn}, ${last!.salesPerDay.length} days`,
);
console.log(
  `eventDashboard ×30: p50 ${p(0.5)} ms · p95 ${p(0.95)} ms · max ${p(1)} ms (target p95 < 500)`,
);

await mongoose.connection.db!.dropDatabase();
await disconnectDb();
