import type {
  Currency,
  EventCategory,
  EventPhase,
  EventStatus,
  PaletteColor,
  Role,
  SeatStatus,
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
