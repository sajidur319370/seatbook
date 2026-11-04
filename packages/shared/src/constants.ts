export const ROLES = ['attendee', 'organizer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LEVEL: Record<Role, number> = {
  attendee: 10,
  organizer: 20,
  admin: 30,
};

export const EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Derived from status + clock, never stored (data-model.md §9.1). */
export const EVENT_PHASES = [
  'draft',
  'scheduled',
  'on_sale',
  'sales_closed',
  'ended',
  'cancelled',
] as const;
export type EventPhase = (typeof EVENT_PHASES)[number];

export const EVENT_CATEGORIES = [
  'concert',
  'theatre',
  'comedy',
  'sports',
  'conference',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'BDT', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const SEAT_STATUSES = ['available', 'held', 'booked', 'blocked'] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const HOLD_STATUSES = ['active', 'converted', 'released', 'expired'] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export const BOOKING_STATUSES = ['confirmed', 'cancelled'] as const;
export const TICKET_STATUSES = ['issued', 'checked_in', 'void'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const SCAN_RESULTS = [
  'ok',
  'already_checked_in',
  'void',
  'wrong_event',
  'invalid',
  'not_found',
  'outside_window',
] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];
export const SCAN_METHODS = ['qr', 'manual'] as const;

export const APPLICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const NUMBERING = ['ltr', 'rtl'] as const;

export const PALETTE = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const;
export type PaletteColor = (typeof PALETTE)[number];

export const PAYMENT_TOKENS = [
  'tok_visa',
  'tok_mastercard',
  'tok_chargeDeclined',
  'tok_slow',
  'tok_providerError',
] as const;
export type PaymentToken = (typeof PAYMENT_TOKENS)[number];

export const HOLD = {
  minutes: 10,
  paymentWindowSec: 120, // checkout extends the hold to at least now + 2 min
  checkoutLockStaleSec: 60, // a checkout lock older than this can be taken over
  maxCheckoutAttempts: 3,
  maxActiveHoldsPerUser: 3, // across events (Should)
} as const;

export const SWEEPER = {
  intervalMs: 5_000,
  batchSize: 500,
  concurrency: 25,
  lockTtlMs: 30_000,
} as const;

export const LIMITS = {
  sectionsPerEvent: 20,
  rowsPerSection: 50,
  seatsPerRow: 100,
  seatsPerEvent: 5_000,
  tiersPerEvent: 10,
  gridSize: 400, // max x / y
  maxRowOffset: 50,
  maxSeatsPerOrder: 10,
  defaultSeatsPerOrder: 8,
  eventsPerOrganizer: 200,
  maxPrice: 1_000_000, // minor units: 10,000.00
  maxEventHours: 24,
} as const;

export const TICKET_CODE_VERSION = 'SB1';
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const SECTION_CODE = /^[A-Z0-9]{1,4}$/;
export const ROW_LABEL = /^[A-Z]{1,2}$/;
export const MANUAL_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
export const BOOKING_REFERENCE = /^SB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
export const OBJECT_ID = /^[a-f0-9]{24}$/i;
