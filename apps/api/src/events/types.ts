import type { Types } from 'mongoose';
import type { Role, SeatStatus } from '@seatbook/shared';

export interface SeatChange {
  seatId: string;
  status: SeatStatus;
  version: number;
  holdExpiresAt: string | null;
}

export type DomainEvent =
  | { type: 'seats.changed'; eventId: Types.ObjectId; changes: SeatChange[] }
  | {
      type: 'hold.changed';
      userId: Types.ObjectId;
      eventId: Types.ObjectId;
      reason:
        'seat_added' | 'seat_removed' | 'released' | 'expired' | 'converted' | 'payment_window';
    }
  | { type: 'event.updated'; eventId: Types.ObjectId }
  | {
      type: 'account.changed';
      userId: Types.ObjectId;
      role: Role;
      suspended: boolean;
      application?: { status: 'approved' | 'rejected' };
    }
  | {
      type: 'booking.confirmed';
      userId: Types.ObjectId;
      eventId: Types.ObjectId;
      bookingId: Types.ObjectId;
    }
  | { type: 'sales.changed'; eventId: Types.ObjectId; seats: number; revenue: number };
// Day 18: checkin.recorded
