import { formatMoney } from '@seatbook/shared';
import { env } from '../config/env';
import type { BookingLean } from '../db/models';
import { formatEventTimeServer } from '../lib/eventTime';

export const applicationApproved = (name: string, org: string) => ({
  subject: 'You can now create events on SeatBook',
  text: `Hi ${name},\n\n${org} is approved as an organizer. Create your first event: ${env.APP_URL}/organizer\n`,
});

export const applicationRejected = (name: string, reason: string) => ({
  subject: 'About your SeatBook organizer application',
  text: `Hi ${name},\n\nWe couldn't approve your application this time.\nReason: ${reason}\n\nYou can apply again in 7 days.\n`,
});

export const accountSuspended = (name: string, reason: string) => ({
  subject: 'Your SeatBook account is suspended',
  text: `Hi ${name},\n\nYour account was suspended. Reason: ${reason}\n`,
});

export const bookingConfirmed = (b: BookingLean) => ({
  subject: `Your tickets for ${b.event.title} (${b.reference})`,
  text: [
    `Hi ${b.buyer.name},`,
    ``,
    `You're going to ${b.event.title}!`,
    `${formatEventTimeServer(b.event.startsAt, b.event.timezone)} · ${b.event.venueName}, ${b.event.city}`,
    ``,
    ...b.items.map((i) => `• ${i.label} (${i.tierName}) ${formatMoney(i.price, b.currency)}`),
    `Total: ${formatMoney(b.total, b.currency)}`,
    ``,
    `Your tickets: ${env.APP_URL}/bookings/${b._id}`, // a link, never the codes (FR-TKT-09)
  ].join('\n'),
});
