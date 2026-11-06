import type { Role, SeatStatus } from './constants';
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

export interface ServerToClientEvents {
  'seats:changed': (p: SeatsChangedPayload) => void;
  'event:updated': (p: { eventId: Id; event: PublicEventDto; emittedAt: string }) => void;
  'hold:changed': (p: HoldChangedPayload) => void;
  'account:changed': (p: AccountChangedPayload) => void;
  // Day 16: 'booking:confirmed', 'sales:updated' · Day 18: 'checkin:recorded'
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
