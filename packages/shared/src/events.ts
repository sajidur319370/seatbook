import type { Role, ScanResult, SeatStatus } from './constants';
import type { CheckInCounts, CheckinTicketDto } from './schemas/checkin';
import type { HoldDto, Id, PublicEventDto } from './dto';

export interface SeatChangeDto {
  seatId: Id;
  status: SeatStatus;
  version: number;
  holdExpiresAt: string | null;
}

export interface SeatsChangedPayload {
  eventId: Id;
  changes: SeatChangeDto[];
  clientMutationId?: string;
  emittedAt: string;
}

export interface HoldChangedPayload {
  eventId: Id;
  hold: HoldDto | null;
  reason: string;
  serverTime: string; // the same clock as REST answers, so Day 13's ordering check keeps working
  clientMutationId?: string;
}

export interface AccountChangedPayload {
  role: Role;
  suspended: boolean;
  application?: { status: 'approved' | 'rejected' };
}

export interface BookingConfirmedPayload {
  eventId: Id;
  bookingId: Id;
}

export interface SalesUpdatedPayload {
  eventId: Id;
  seatsSold: number;
  revenue: number; // minor units
}

/** Staff room only: the holder's name is fine there (NFR-PRIV-01). */
export interface CheckinRecordedPayload {
  eventId: Id;
  result: ScanResult;
  ticket: CheckinTicketDto | null;
  counts: CheckInCounts;
  at: string;
}

export interface ServerToClientEvents {
  'seats:changed': (p: SeatsChangedPayload) => void;
  'event:updated': (p: { eventId: Id; event: PublicEventDto; emittedAt: string }) => void;
  'hold:changed': (p: HoldChangedPayload) => void;
  'account:changed': (p: AccountChangedPayload) => void;
  'booking:confirmed': (p: BookingConfirmedPayload) => void; // the buyer's own tabs
  'sales:updated': (p: SalesUpdatedPayload) => void; // the event's staff room
  'checkin:recorded': (p: CheckinRecordedPayload) => void; // the event's staff room
}

export type Ack = { ok: true } | { ok: false; code: string };

export interface ClientToServerEvents {
  'event:join': (p: { eventId: Id }, ack: (r: Ack) => void) => void;
  'event:leave': (p: { eventId: Id }) => void;
  'staff:join': (p: { eventId: Id }, ack: (r: Ack) => void) => void;
  'staff:leave': (p: { eventId: Id }) => void;
}

export interface SocketData {
  userId: string;
  role: Role;
}
