import { newId, rowLabel, type PaletteColor } from '@seatbook/shared';
import { connectDb, disconnectDb } from '../src/db/connection';
import { Event, User } from '../src/db/models';
import { addDays } from '../src/lib/dates';
import { slugWithSuffix } from '../src/lib/slug';
import { publishEvent } from '../src/modules/organizer/publish.service';
import { makeCtx } from '../src/types/ctx';

// A published 5,000-seat event, useful until the Day 20 seed.
// usage: npm run make-big-event -- organizer@example.com
const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error('Usage: npm run make-big-event -- organizer@example.com');
  process.exit(1);
}

await connectDb();
const org = await User.findOne({ email }).lean();
if (!org) {
  console.error(`❌ No user with email ${email}`);
  process.exitCode = 1;
} else {
  const tier = (name: string, price: number, color: PaletteColor) => ({
    _id: newId(),
    name,
    price,
    color,
  });
  // Prices are in minor units: 900,000 paisa is BDT 9,000.
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
  })); // 10 × 25 × 20 = 5,000 seats

  const startsAt = addDays(new Date(), 30);
  const title = 'Big Arena Night';
  const event = await Event.create({
    organizerId: org._id,
    title,
    slug: slugWithSuffix(title),
    summary: 'A 5,000-seat test event',
    category: 'concert',
    venue: { name: 'National Arena', address: '', city: 'Dhaka' },
    timezone: 'Asia/Dhaka',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
    currency: 'BDT',
    seatMap: { stageLabel: 'STAGE', sections },
    tiers,
  });
  await publishEvent(makeCtx({ userId: org._id, role: org.role }), event._id);
  console.log(`✅ Published /e/${event.slug}`);
}
await disconnectDb();
