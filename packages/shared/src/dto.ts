import type {
  Currency,
  EventCategory,
  EventPhase,
  EventStatus,
  PaletteColor,
  Role,
} from './constants';

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

/** Sections and tiers get their real types with the layout schema on Day 7. */
export interface SeatMapDto {
  stageLabel: string;
  sections: unknown[];
  tiers: unknown[];
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
// More DTOs are added day by day.
