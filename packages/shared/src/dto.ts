import type { SeatChangeDto } from './events';
import type {
  Currency,
  EventCategory,
  EventPhase,
  EventStatus,
  PaletteColor,
  Role,
  SeatStatus,
  TicketStatus,
} from './constants';
import type { SectionInput, TierInput } from './seatmap';

export type Id = string;

export interface UserDto {
  id: Id;
  email: string;
  name: string;
  avatarColor: string;
  timezone: string;
  role: Role; // the UI adapts to it; the API never trusts it from the client
  organizationName: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}
export interface ApplicationSummaryDto {
  id: Id;
  status: 'pending' | 'approved' | 'rejected';
  organizationName: string;
  rejectionReason: string | null;
  createdAt: string;
}
export interface MeResponse {
  user: UserDto;
  application: ApplicationSummaryDto | null; // organizer application, filled in on Day 5
}

export interface TierDto {
  id: Id;
  name: string;
  price: number;
  color: PaletteColor;
  remaining?: number;
}

/** String ids, same shape as the input, so the builder round-trips it. */
export interface SeatMapDto {
  stageLabel: string;
  sections: SectionInput[];
  tiers: TierInput[];
}

export interface PublicEventDto {
  id: Id;
  slug: string;
  title: string;
  summary: string;
  description?: string;
  category: EventCategory;
  venue: { name: string; address: string; city: string };
  timezone: string;
  startsAt: string;
  endsAt: string;
  salesStartAt: string | null;
  salesEndAt: string | null;
  currency: Currency;
  maxSeatsPerOrder: number;
  coverColor: PaletteColor;
  phase: EventPhase;
  soldOut: boolean;
  lowestPrice: number | null;
  organizerName?: string;
  tiers?: TierDto[];
}

export interface OrganizerEventDto extends PublicEventDto {
  status: EventStatus;
  revision: number;
  refundsAllowed: boolean;
  counters: {
    seatsTotal: number;
    seatsSellable: number;
    seatsSold: number;
    ticketsCheckedIn: number;
    revenue: number;
  };
  seatMap: SeatMapDto;
}

export interface SeatCell {
  id: Id;
  s: number; // section index in layout.sections
  r: string; // row label
  n: number; // seat number
  x: number;
  y: number;
  t: number; // tier index in tiers
  st: SeatStatus; // expired holds already turned into 'available'
  v: number; // version (real-time ordering, Day 15)
  exp?: string; // holdExpiresAt for held seats (local expiry timers, Day 15)
}

export interface SeatMapResponse {
  serverTime: string;
  event: PublicEventDto;
  layout: { stageLabel: string; sections: SectionInput[] };
  tiers: TierInput[];
  seats: SeatCell[];
}

/** Label the client derives instead of receiving it 5,000 times. */
export const seatLabel = (sectionCode: string, row: string, n: number) =>
  `${sectionCode}-${row}${n}`;
// More DTOs are added day by day.

export interface HeldSeatDto {
  id: Id;
  label: string;
  section: string;
  row: string;
  number: number;
  tierId: Id;
  tierName: string;
  price: number;
}

export interface HoldDto {
  id: Id;
  eventId: Id;
  expiresAt: string; // ISO; countdown = expiresAt - (Date.now() + clockOffset)
  checkoutInProgress: boolean;
  seats: HeldSeatDto[];
  total: number;
  currency: Currency;
}

export interface HoldResponse {
  serverTime: string; // FR-HOLD-10
  hold: HoldDto | null;
  changes?: SeatChangeDto[]; // what this request did to each seat: writes only
}

export interface TicketSummaryDto {
  id: Id;
  seatLabel: string;
  sectionName: string;
  row: string;
  number: number;
  tierName: string;
  price: number;
  status: TicketStatus;
  checkedInAt: string | null;
}

/** Never carries a ticket code: those come one ticket at a time (Day 17, FR-TKT-06). */
export interface BookingDto {
  id: Id;
  reference: string;
  status: 'confirmed' | 'cancelled';
  event: {
    id: Id;
    title: string;
    slug: string;
    startsAt: string;
    venueName: string;
    city: string;
    timezone: string;
  };
  items: {
    seatId: Id;
    label: string;
    sectionName: string;
    row: string;
    number: number;
    tierName: string;
    price: number;
  }[];
  total: number;
  currency: Currency;
  payment: { brand: string | null; last4: string | null; paidAt: string };
  tickets: TicketSummaryDto[];
  createdAt: string;
}

export interface CheckoutResponse {
  booking: BookingDto;
}

/** The event as a booking or ticket list shows it: the snapshot taken at purchase. */
export interface BookedEventDto {
  id: Id;
  title: string;
  slug: string;
  startsAt: string;
  venueName: string;
  city: string;
  timezone: string;
}

/** One row of "My bookings" (FR-TKT-04): no tickets, no codes. */
export interface BookingListItemDto {
  id: Id;
  reference: string;
  status: 'confirmed' | 'cancelled';
  event: BookedEventDto;
  seats: number;
  total: number;
  currency: Currency;
  createdAt: string;
}

export interface MyBookingsResponse {
  items: BookingListItemDto[];
  nextCursor: string | null;
}

/** "My tickets" (FR-TKT-05): grouped by event, and never a code (FR-TKT-09). */
export interface MyTicketsResponse {
  groups: { event: BookedEventDto; tickets: TicketSummaryDto[] }[];
}

export interface TicketDto extends TicketSummaryDto {
  eventId: Id;
  bookingId: Id;
  eventTitle: string;
  eventStartsAt: string;
  currency: Currency;
  holderName: string;
}

/** The one place a ticket's codes leave the server (FR-TKT-06). Sent with Cache-Control: no-store. */
export interface TicketResponse {
  ticket: TicketDto;
  qrDataUrl: string | null; // null when void
  manualCode: string | null; // "7KQ2-9XF3-AB"
  event: BookedEventDto;
}
